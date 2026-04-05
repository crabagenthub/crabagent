"use client";

import { useMemo } from "react";
import { jsonTokenClassName, tokenizeJsonDisplay } from "@/lib/json-syntax-highlight";
import { splitHighlight } from "@/lib/text-search-highlight";
import { cn } from "@/lib/utils";

const MARK_CLASS = "rounded-sm bg-amber-200/90 px-0.5 text-neutral-900 dark:bg-amber-500/40 dark:text-neutral-50";

function isValidJsonDocument(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

export function JsonHighlightedBlock({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const nodes = useMemo(() => {
    const tokens = tokenizeJsonDisplay(text);
    return tokens.flatMap((tok, ti) => {
      const baseCls = jsonTokenClassName(tok.kind);
      const parts = splitHighlight(tok.text, query);
      return parts.map((p, pi) => (
        <span key={`${ti}-${pi}`} className={cn(baseCls)}>
          {p.hit ? <mark className={MARK_CLASS}>{p.v}</mark> : p.v}
        </span>
      ));
    });
  }, [text, query]);

  return (
    <pre
      className={cn(
        "m-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200",
        className,
      )}
    >
      {nodes}
    </pre>
  );
}

/** When `text` is valid JSON, syntax-highlight; otherwise plain text + search marks. */
export function HighlightedBlockWithOptionalJson({
  text,
  query,
  json,
  className,
}: {
  text: string;
  query: string;
  json: boolean;
  className?: string;
}) {
  const useJson = json && isValidJsonDocument(text);
  const plainParts = useMemo(() => splitHighlight(text, query), [text, query]);

  if (useJson) {
    return <JsonHighlightedBlock text={text} query={query} className={className} />;
  }

  return (
    <pre
      className={cn(
        "m-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200",
        className,
      )}
    >
      {plainParts.map((p, i) =>
        p.hit ? (
          <mark key={i} className={MARK_CLASS}>
            {p.v}
          </mark>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </pre>
  );
}
