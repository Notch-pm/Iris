// Export CSV exploitable sous Excel (motif Clara `components/data-table/csv-export.ts`).
// Logique pure (escape/build) séparée du déclenchement navigateur (download).

/** Séparateur recommandé pour une ouverture directe dans Excel FR. */
export const CSV_DELIMITER = ";";

/** Échappe une valeur pour une cellule CSV (RFC 4180). */
export function escapeCsvValue(value: unknown, delimiter: string = CSV_DELIMITER): string {
  const str = value == null ? "" : String(value);
  const needsQuoting =
    str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r");
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => unknown;
}

/** Contenu CSV complet (en-têtes + lignes), fins de ligne CRLF. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[], delimiter: string = CSV_DELIMITER): string {
  const headerLine = columns.map((c) => escapeCsvValue(c.header, delimiter)).join(delimiter);
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvValue(c.accessor(row), delimiter)).join(delimiter),
  );
  return [headerLine, ...lines].join("\r\n");
}

/**
 * Lecture d'un CSV (RFC 4180 : guillemets doublés, CRLF ou LF) — l'inverse de
 * `buildCsv`, pour les réponses CSV d'un service tiers (géocodage en masse).
 * Tolérant : une ligne mal fermée rend simplement ce qui a été lu.
 */
export function parseCsv(text: string, delimiter: string = CSV_DELIMITER): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (char === '"' && field === "") { quoted = true; continue; }
    if (char === delimiter) { pushField(); continue; }
    if (char === "\r") continue;
    if (char === "\n") { pushRow(); continue; }
    field += char;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/**
 * Téléchargement navigateur d'un CSV, préfixé d'un BOM UTF-8 pour qu'Excel FR
 * affiche correctement les accents à l'ouverture directe (double-clic).
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Nom de fichier d'export : `<prefixe>-<tenant épuré>-AAAA-MM-JJ.csv`.
 * Partagé par toutes les listes exportables (demandes, usagers…).
 */
export function csvFilename(prefix: string, tenantName: string, now: Date): string {
  const slug = tenantName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tenant";
  const day = now.toISOString().slice(0, 10);
  return `${prefix}-${slug}-${day}.csv`;
}
