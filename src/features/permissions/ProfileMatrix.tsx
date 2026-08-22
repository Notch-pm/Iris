// Matrice démarche × droits d'un profil (RM-37) : démarches actives du
// tenant groupées par catégorie Socle, recherche, action « appliquer à toute
// la catégorie » (agit TOUJOURS sur la catégorie complète, jamais seulement
// sur ce que la recherche affiche — B3). Les lignes de démarches devenues
// obsolètes ou disparues du cache mais déjà présentes dans le profil sont
// conservées avec un badge (RM-35, CL-25) — jamais supprimées silencieusement
// par l'UI. Une ligne qui relève encore du défaut (I1) reste en lecture
// seule (badge « Suit le défaut ») jusqu'à un geste explicite
// « Personnaliser cette démarche », pour ne jamais figer une exception au
// premier clic dans son sélecteur.

import * as React from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Right } from "@/features/rights/rights";
import {
  isClosureWithoutProcess, PRESET_LEVELS, presetFor, rightsForPreset, type PresetLevelId,
} from "./profileValidation";
import { RightsPicker } from "./RightsPicker";
import type { ProcedureCacheFullRow } from "./usePermissions";

interface MatrixRow {
  id: string;
  name: string;
  categoryName: string | null;
  obsolete: boolean;
  unknown: boolean;
}

function buildMatrixRows(procedures: ProcedureCacheFullRow[], explicitIds: string[]): MatrixRow[] {
  const byId = new Map(procedures.map((p) => [p.socle_id, p]));
  const rows: MatrixRow[] = procedures
    .filter((p) => p.obsoleted_at === null)
    .map((p) => ({ id: p.socle_id, name: p.name, categoryName: p.category_name, obsolete: false, unknown: false }));

  for (const id of explicitIds) {
    const p = byId.get(id);
    if (!p) {
      rows.push({ id, name: id, categoryName: null, obsolete: false, unknown: true });
    } else if (p.obsoleted_at !== null) {
      rows.push({ id, name: p.name, categoryName: p.category_name, obsolete: true, unknown: false });
    }
  }
  return rows;
}

function groupByCategory(list: MatrixRow[]): Map<string, MatrixRow[]> {
  const map = new Map<string, MatrixRow[]>();
  for (const r of list) {
    const key = r.categoryName ?? "Sans catégorie";
    const group = map.get(key) ?? [];
    group.push(r);
    map.set(key, group);
  }
  return map;
}

function defaultLevelLabel(defaultRights: Right[]): string {
  const preset = presetFor(defaultRights);
  return preset ? (PRESET_LEVELS.find((p) => p.id === preset)?.label ?? "Détaillé") : "Détaillé";
}

interface ProfileMatrixProps {
  /** Démarches actives ET obsolètes du cache — `useAllProcedureRows`. */
  procedures: ProcedureCacheFullRow[];
  /** Droits par défaut du profil — pré-remplit « Personnaliser cette démarche » (I1) et le compteur (I13). */
  defaultRights: Right[];
  value: Record<string, Right[]>;
  onChange: (next: Record<string, Right[]>) => void;
}

export function ProfileMatrix({ procedures, defaultRights, value, onChange }: ProfileMatrixProps) {
  const [query, setQuery] = React.useState("");
  const explicitIds = Object.keys(value);
  const rows = React.useMemo(() => buildMatrixRows(procedures, explicitIds), [procedures, explicitIds.join(",")]);
  // B3 : la base « catégorie complète » n'est JAMAIS filtrée par la recherche
  // — sinon « Appliquer à toute la catégorie » agirait sur un sous-ensemble
  // invisible à l'admin, silencieusement.
  const rowsByCategory = React.useMemo(() => groupByCategory(rows), [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.categoryName ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const groups = React.useMemo(
    () => [...groupByCategory(filtered).entries()].sort(([a], [b]) => a.localeCompare(b, "fr")),
    [filtered],
  );

  function setRow(id: string, rights: Right[]) {
    onChange({ ...value, [id]: rights });
  }
  function clearRow(id: string) {
    const next = { ...value };
    delete next[id];
    onChange(next);
  }
  function applyToCategory(category: string, presetId: PresetLevelId) {
    const categoryRows = rowsByCategory.get(category) ?? [];
    const rights = rightsForPreset(presetId);
    const next = { ...value };
    for (const r of categoryRows) next[r.id] = rights;
    onChange(next);
  }

  const activeCacheCount = procedures.filter((p) => p.obsoleted_at === null).length;
  const explicitActiveCount = explicitIds.filter((id) =>
    procedures.some((p) => p.socle_id === id && p.obsoleted_at === null),
  ).length;
  const defaultCount = activeCacheCount - explicitActiveCount;
  const currentDefaultLabel = defaultLevelLabel(defaultRights);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Rechercher une démarche"
            className="h-8 pl-8 text-xs"
            placeholder="Rechercher une démarche…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {activeCacheCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {defaultCount} démarche{defaultCount > 1 ? "s" : ""} active{defaultCount > 1 ? "s" : ""}{" "}
            {defaultCount > 1 ? "suivent" : "suit"} les droits par défaut ci-dessus ({currentDefaultLabel}).
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucune démarche active pour ce tenant — la synchronisation avec le Socle est
          automatique (quotidienne). Si le problème persiste, contactez le support.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucune démarche ne correspond à cette recherche.
        </p>
      ) : (
        <div className="flex max-h-80 flex-col gap-1 overflow-auto rounded-[14px] border border-border p-3">
          {groups.map(([category, categoryRows]) => {
            const fullCategoryRows = rowsByCategory.get(category) ?? categoryRows;
            const isFiltered = fullCategoryRows.length !== categoryRows.length;
            return (
              <div key={category}>
                <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5 pt-3 first:pt-0">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {category} <span className="font-normal normal-case">· {categoryRows.length}</span>
                    {isFiltered ? (
                      <span className="font-normal normal-case"> sur {fullCategoryRows.length}</span>
                    ) : null}
                  </h4>
                  {fullCategoryRows.length > 1 ? (
                    <Select
                      aria-label={`Appliquer un niveau à toute la catégorie ${category} (${fullCategoryRows.length} démarches, y compris celles non affichées par la recherche)`}
                      title="S'applique à TOUTE la catégorie, y compris les démarches non affichées par la recherche en cours."
                      className="h-7 w-auto text-xs"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) applyToCategory(category, e.target.value as PresetLevelId);
                        e.target.value = "";
                      }}
                    >
                      <option value="">Appliquer à toute la catégorie…</option>
                      {PRESET_LEVELS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </Select>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-2 py-2">
                  {categoryRows.map((r) => {
                    const hasExplicit = Object.prototype.hasOwnProperty.call(value, r.id);
                    const rowRights = hasExplicit ? (value[r.id] ?? []) : defaultRights;
                    const isExplicitEmpty = hasExplicit && rowRights.length === 0;
                    const closureWithoutProcess = hasExplicit && isClosureWithoutProcess(rowRights);
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-1 py-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{r.name}</span>
                          {r.obsolete ? <Badge variant="secondary">Obsolète</Badge> : null}
                          {r.unknown ? <Badge variant="secondary">Démarche inconnue</Badge> : null}
                          {closureWithoutProcess ? <Badge variant="secondary">Clôture sans instruction</Badge> : null}
                          {!hasExplicit ? (
                            <Badge variant="muted">Suit le défaut ({currentDefaultLabel})</Badge>
                          ) : isExplicitEmpty ? (
                            <Badge variant="muted">Exception : aucun droit</Badge>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {hasExplicit ? (
                            <>
                              <div className="w-52">
                                <RightsPicker
                                  idPrefix={`matrix-${r.id}`}
                                  label={`Droits sur ${r.name}`}
                                  value={value[r.id] ?? []}
                                  onChange={(rights) => setRow(r.id, rights)}
                                />
                              </div>
                              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => clearRow(r.id)}>
                                Revenir au défaut
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setRow(r.id, defaultRights)}
                            >
                              Personnaliser cette démarche
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
