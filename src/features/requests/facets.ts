// Construction des facettes de filtres (destinataire, démarche, source) à
// partir des demandes existantes du tenant. Tant que le miroir Socle n'est pas
// synchronisé (phase 1 suite), les valeurs observées font office de catalogue.

export interface FacetRow {
  socle_organization_id: string | null;
  socle_organization_label: string | null;
  socle_procedure_id: string | null;
  socle_procedure_label: string | null;
  source: string;
}

export interface FacetOption {
  value: string;
  label: string;
}

export interface RequestFacets {
  destinataires: FacetOption[];
  procedures: FacetOption[];
  sources: FacetOption[];
}

function collator(a: FacetOption, b: FacetOption): number {
  return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
}

export function buildRequestFacets(rows: FacetRow[]): RequestFacets {
  const destinataires = new Map<string, string>();
  const procedures = new Map<string, string>();
  const sources = new Set<string>();
  for (const row of rows) {
    if (row.socle_organization_id) {
      destinataires.set(
        row.socle_organization_id,
        row.socle_organization_label ?? row.socle_organization_id,
      );
    }
    if (row.socle_procedure_id) {
      procedures.set(row.socle_procedure_id, row.socle_procedure_label ?? row.socle_procedure_id);
    }
    sources.add(row.source);
  }
  const toOptions = (m: Map<string, string>) =>
    Array.from(m, ([value, label]) => ({ value, label })).sort(collator);
  return {
    destinataires: toOptions(destinataires),
    procedures: toOptions(procedures),
    sources: Array.from(sources, (s) => ({ value: s, label: s })).sort(collator),
  };
}
