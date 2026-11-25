import { createHash } from "node:crypto";

/**
 * Hierarchical chunking: small child chunks are what gets searched (precise
 * matches), the larger parent they came from is what gets read (enough context
 * to answer). Parents follow the document's own headings where it has them.
 */

export const CHILD_SIZE = 500;
export const CHILD_OVERLAP = 100;
export const MIN_PARENT = 1500;
export const MAX_PARENT = 3500;

export interface ParentChunk {
  id: string;
  ord: number;
  heading: string;
  text: string;
}

export interface ChildChunk {
  id: string;
  parentId: string;
  ord: number;
  text: string;
}

export interface Chunked {
  parents: ParentChunk[];
  children: ChildChunk[];
}

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Section {
  heading: string;
  body: string;
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;

/** Split on markdown headings, keeping the heading trail ("Checkout › Coupons"). */
function sections(text: string): Section[] {
  const out: Section[] = [];
  const trail: string[] = [];
  let heading = "";
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) out.push({ heading, body });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      const depth = match[1].length;
      trail.length = depth - 1;
      trail[depth - 1] = match[2];
      heading = trail.filter(Boolean).join(" › ");
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

/** A paragraph longer than the parent ceiling is cut at the last sentence or space. */
function splitLong(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("\n"),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
    );
    const at = cut > max * 0.5 ? cut + 1 : Math.max(window.lastIndexOf(" "), Math.floor(max * 0.5));
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

function buildParents(documentId: string, input: Section[]): ParentChunk[] {
  const parents: ParentChunk[] = [];
  let heading = "";
  let buffer: string[] = [];
  let size = 0;

  const flush = () => {
    const text = buffer.join("\n\n").trim();
    if (text) {
      const ord = parents.length;
      parents.push({ id: `${documentId}:${ord}`, ord, heading, text });
    }
    buffer = [];
    size = 0;
  };

  for (const section of input) {
    // A new heading closes the parent, unless it is still too small to stand
    // alone — then the next section rides along rather than leaving a stub.
    if (size >= MIN_PARENT / 2) flush();
    if (buffer.length === 0) heading = section.heading;
    else if (section.heading && section.heading !== heading) {
      // Merged under another section's heading: keep this one in the text.
      buffer.push(section.heading);
      size += section.heading.length + 2;
    }

    const paragraphs = section.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => (p.length > MAX_PARENT ? splitLong(p, MAX_PARENT) : [p]));

    for (const paragraph of paragraphs) {
      if (size > 0 && size + paragraph.length > MAX_PARENT) flush();
      if (buffer.length === 0) heading = section.heading;
      buffer.push(paragraph);
      size += paragraph.length + 2;
    }
  }
  flush();
  return parents;
}

/** Windows of CHILD_SIZE with CHILD_OVERLAP, broken on a sentence or word when one is near. */
function childTexts(parent: string): string[] {
  if (parent.length <= CHILD_SIZE) return [parent];
  const out: string[] = [];
  let pos = 0;
  while (pos < parent.length) {
    let end = Math.min(pos + CHILD_SIZE, parent.length);
    if (end < parent.length) {
      const window = parent.slice(pos, end);
      const floor = Math.floor(CHILD_SIZE * 0.6);
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
        window.lastIndexOf("\n"),
      );
      const space = window.lastIndexOf(" ");
      if (sentence >= floor) end = pos + sentence + 1;
      else if (space >= floor) end = pos + space;
    }
    const piece = parent.slice(pos, end).trim();
    if (piece) out.push(piece);
    if (end >= parent.length) break;
    pos = Math.max(end - CHILD_OVERLAP, pos + 1);
    // Start the next window on a word rather than inside one.
    const nextSpace = parent.indexOf(" ", pos);
    if (nextSpace !== -1 && nextSpace - pos < 20 && nextSpace < end) pos = nextSpace + 1;
  }
  return out;
}

export function chunkDocument(documentId: string, rawText: string): Chunked {
  const text = rawText
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  if (!text.trim()) return { parents: [], children: [] };

  const parents = buildParents(documentId, sections(text));
  const children: ChildChunk[] = [];
  for (const parent of parents) {
    childTexts(parent.text).forEach((piece, ord) => {
      children.push({ id: `${parent.id}:${ord}`, parentId: parent.id, ord, text: piece });
    });
  }
  return { parents, children };
}

/** What is actually matched against: the child with its heading trail in front. */
export function searchText(heading: string, child: string): string {
  return heading ? `${heading}\n${child}` : child;
}
