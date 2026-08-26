export interface ParsedDocument {
  name: string;
  text: string;
  bytes: number;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "yaml", "yml", "html", "htm", "rst", "adoc",
]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export async function parseDocument(
  name: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const ext = extensionOf(name);
  let text: string;

  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } else if (ext === "docx") {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (TEXT_EXTENSIONS.has(ext) || ext === "") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(
      `Cannot read .${ext} files. Supported: pdf, docx, md, txt, csv, json, yaml, html.`,
    );
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!text) {
    throw new Error(`No text could be extracted from ${name}. Is it a scanned image?`);
  }
  return { name, text, bytes: buffer.byteLength };
}
