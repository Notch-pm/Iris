// Rendu des textes Markdown du référentiel (base de connaissances des
// démarches). L'analyse vit dans `src/lib/markdown.ts` (pure, testée) ; ce
// composant ne fait qu'afficher les blocs en éléments React — jamais de HTML
// injecté, jamais de `dangerouslySetInnerHTML`.

import * as React from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function InlineRun({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((item, i) => {
        switch (item.kind) {
          case "strong":
            return <strong key={i} className="font-bold">{item.text}</strong>;
          case "em":
            return <em key={i} className="italic">{item.text}</em>;
          case "code":
            return (
              <code key={i} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">
                {item.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {item.text}
              </a>
            );
          default:
            return <React.Fragment key={i}>{item.text}</React.Fragment>;
        }
      })}
    </>
  );
}

const HEADING_CLASS = {
  1: "text-[13.5px] font-bold",
  2: "text-[12.5px] font-bold",
  3: "text-[12px] font-bold uppercase tracking-wide text-muted-foreground",
} as const;

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (["h4", "h5", "h6"] as const)[block.level - 1];
      return <Tag className={cn("mt-1 leading-snug first:mt-0", HEADING_CLASS[block.level])}>
        <InlineRun items={block.content} />
      </Tag>;
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("flex flex-col gap-1 pl-4", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed marker:text-muted-foreground">
              <InlineRun items={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="whitespace-pre-line border-l-2 border-secondary pl-2.5 leading-relaxed text-muted-foreground">
          <InlineRun items={block.content} />
        </blockquote>
      );
    case "rule":
      return <hr className="border-border" />;
    default:
      return (
        <p className="whitespace-pre-line leading-relaxed">
          <InlineRun items={block.content} />
        </p>
      );
  }
}

/** Texte Markdown du référentiel. Un texte vide ne rend rien. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2 text-[12.5px] text-foreground", className)}>
      {blocks.map((block, i) => <BlockView key={i} block={block} />)}
    </div>
  );
}
