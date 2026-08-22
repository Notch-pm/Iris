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
