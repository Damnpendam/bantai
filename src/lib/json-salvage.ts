/**
 * Close any structures left open by a truncated response. Returns null when the
 * prefix ends mid-string, where guessing would corrupt the content.
 */
function closeOpenStructures(prefix: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of prefix) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString || stack.length === 0) return null;
  let out = prefix;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Small models routinely hit their output ceiling mid-suite. The cases they did
 * finish are still good work, so trim back to the last complete array element and
 * close the structure rather than discarding the whole response.
 */
export function salvageTruncatedJson(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      // An object that closes while still inside an array is a whole element.
      if (ch === "}" && stack[stack.length - 1] === "[") lastComplete = i;
    }
  }

  if (lastComplete === -1) return null;
  return closeOpenStructures(text.slice(0, lastComplete + 1));
}


/**
 * Small models wrap JSON in markdown fences or a sentence of preamble even when
 * asked not to. Peel that off before parsing rather than discarding a good response.
 */
function unwrapToJson(raw: string): string {
  let text = raw.trim();

  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/);
  if (fenced && fenced[1].trim()) text = fenced[1].trim();

  const first = text.search(/[{[]/);
  if (first > 0) text = text.slice(first);

  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (lastBrace !== -1 && lastBrace < text.length - 1) {
    const trimmed = text.slice(0, lastBrace + 1);
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Trailing text was part of a truncated structure; leave it for salvage.
    }
  }
  return text;
}

export interface ParsedModelJson {
  value: unknown;
  salvaged: boolean;
}

/**
 * Turn whatever a model actually returned into JSON, or null if it cannot be done.
 * Order matters: try the response as-is, then unwrapped, then salvaged.
 */
export function parseModelJson(raw: string): ParsedModelJson | null {
  const attempts: [string, boolean][] = [];
  attempts.push([raw, false]);

  const unwrapped = unwrapToJson(raw);
  if (unwrapped !== raw) attempts.push([unwrapped, false]);

  for (const [candidate, salvaged] of attempts) {
    try {
      return { value: JSON.parse(candidate), salvaged };
    } catch {
      // Try the next strategy.
    }
  }

  for (const [candidate] of attempts) {
    const repaired = salvageTruncatedJson(candidate);
    if (!repaired) continue;
    try {
      return { value: JSON.parse(repaired), salvaged: true };
    } catch {
      // Try the next strategy.
    }
  }
  return null;
}
