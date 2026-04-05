/**
 * Tokenize pretty-printed JSON for display-time syntax highlighting (no AST).
 * Invalid / non-JSON text should be handled by the caller (fallback to plain text).
 */

export type JsonTokenKind =
  | "whitespace"
  | "punct"
  | "key"
  | "string"
  | "number"
  | "keyword"
  | "unknown";

export type JsonToken = { kind: JsonTokenKind; text: string };

function readString(source: string, start: number): { text: string; end: number } {
  let j = start + 1;
  const n = source.length;
  while (j < n) {
    const ch = source[j]!;
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === '"') {
      return { text: source.slice(start, j + 1), end: j + 1 };
    }
    j++;
  }
  return { text: source.slice(start, n), end: n };
}

function readNumber(source: string, start: number): { text: string; end: number } {
  let j = start;
  const n = source.length;
  if (source[j] === "-") {
    j++;
  }
  while (j < n && source[j]! >= "0" && source[j]! <= "9") {
    j++;
  }
  if (j < n && source[j] === ".") {
    j++;
    while (j < n && source[j]! >= "0" && source[j]! <= "9") {
      j++;
    }
  }
  if (j < n && (source[j] === "e" || source[j] === "E")) {
    j++;
    if (j < n && (source[j] === "+" || source[j] === "-")) {
      j++;
    }
    while (j < n && source[j]! >= "0" && source[j]! <= "9") {
      j++;
    }
  }
  return { text: source.slice(start, j), end: j };
}

function readKeyword(
  source: string,
  start: number,
  word: string,
): { text: string; end: number } | null {
  if (source.startsWith(word, start)) {
    const next = start + word.length;
    if (next >= source.length || !/[a-zA-Z0-9_]/.test(source[next]!)) {
      return { text: word, end: next };
    }
  }
  return null;
}

export function tokenizeJsonDisplay(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i + 1;
      while (j < n && (source[j] === " " || source[j] === "\t" || source[j] === "\n" || source[j] === "\r")) {
        j++;
      }
      tokens.push({ kind: "whitespace", text: source.slice(i, j) });
      i = j;
      continue;
    }

    if ("{}[],:".includes(c)) {
      tokens.push({ kind: "punct", text: c });
      i++;
      continue;
    }

    if (c === '"') {
      const { text, end } = readString(source, i);
      tokens.push({ kind: "string", text });
      i = end;
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      const { text, end } = readNumber(source, i);
      if (text.length > 0 && text !== "-") {
        tokens.push({ kind: "number", text });
        i = end;
        continue;
      }
    }

    const kw =
      readKeyword(source, i, "true") ??
      readKeyword(source, i, "false") ??
      readKeyword(source, i, "null");
    if (kw) {
      tokens.push({ kind: "keyword", text: kw.text });
      i = kw.end;
      continue;
    }

    tokens.push({ kind: "unknown", text: c });
    i++;
  }

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k]!;
    if (tok.kind !== "string") {
      continue;
    }
    let m = k + 1;
    while (m < tokens.length && tokens[m]!.kind === "whitespace") {
      m++;
    }
    if (tokens[m]?.kind === "punct" && tokens[m]!.text === ":") {
      tokens[k] = { kind: "key", text: tok.text };
    }
  }

  return tokens;
}

export function jsonTokenClassName(kind: JsonTokenKind): string {
  switch (kind) {
    case "key":
      return "text-sky-700 dark:text-sky-400";
    case "string":
      return "text-emerald-800 dark:text-emerald-400";
    case "number":
      return "text-amber-700 dark:text-amber-400";
    case "keyword":
      return "text-violet-700 dark:text-violet-400";
    case "punct":
      return "text-neutral-500 dark:text-neutral-400";
    case "whitespace":
      return "";
    case "unknown":
    default:
      return "text-neutral-800 dark:text-neutral-200";
  }
}
