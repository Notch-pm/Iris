// Texte brut d'un document Word déjà analysé (`parseDocument`). Module PUR.
//
// Usage (2026-11-13) : préremplir le texte du courrier de réponse déposé dans
// Clara à partir d'un courrier prévu au paramétrage de la démarche. Le modèle
// est FUSIONNÉ côté serveur avant extraction : l'agent reçoit un texte déjà
// personnalisé, qu'il relit et retouche — même règle que les modèles d'e-mail
// des Échanges (« ce que l'agent voit est ce qui part »).
//
// La mise en forme est perdue, délibérément : le courrier est visé et mis en
// page dans Clara. On garde ce qui porte du sens dans un texte : les
// paragraphes, les sauts de ligne, les puces, le contenu des tableaux (une
// cellule par ligne — les blocs d'adresse sont souvent des tableaux).

import type { DocParagraph, ParsedDocument } from "./docxParse.ts";

function paragraphText(p: DocParagraph): string {
  const text = p.runs.map((r) => r.text).join("").replace(/\t/g, " ").replace(/[  ]+$/gm, "");
  if (p.bullet && text.trim() !== "") return `${p.bullet.trim() || "•"} ${text.trimStart()}`;
  return text;
}

export function documentPlainText(doc: ParsedDocument): string {
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "paragraph") {
      if (block.paragraph.pageBreakBefore && lines.length > 0) lines.push("");
      lines.push(paragraphText(block.paragraph));
      continue;
    }
    for (const row of block.table.rows) {
      for (const cell of row.cells) {
        for (const p of cell.paragraphs) {
          const text = paragraphText(p);
          if (text.trim() !== "") lines.push(text);
        }
      }
    }
    lines.push("");
  }
  return lines
    .join("\n")
    // Trois lignes vides de suite ne disent rien de plus que deux.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
