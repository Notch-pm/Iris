// Étape 1 — choix de la démarche Socle : recherche, filtre par catégorie de
// démarche, cartes. La démarche est obligatoire (aucune demande libre) et vient
// exclusivement du cache du tenant.
//
// Chaque carte dit la PUBLICATION de la démarche, mais SEULEMENT quand il y a
// quelque chose à en dire : la pastille ne signale que l'ABSENCE du portail
// (décision PO 2026-08-30 — y être est la valeur par défaut du contrat, donc le
// cas ordinaire), et la période ne s'affiche que s'il y en a une. Ce n'est pas
// un détail de gestion : une démarche absente du portail n'arrive au service que
// par le guichet, et une période affichée dit à l'agent jusqu'à quand la
// démarche restera ouverte — une démarche HORS de sa période n'est plus dans la
// liste du tout.
// La liste, elle, ne contient que des démarches PROPOSABLES : ni brouillon, ni
// interne (`useSocleProcedureRows`).
//
// Chaque carte porte aussi un bouton « i » (2026-09-18) : la FICHE de la
// démarche — ce que voit l'usager, les consignes internes, l'assistant — pour
// choisir en connaissance de cause. La carte n'est donc plus UN bouton (un
// bouton n'en contient pas un autre) : le choix passe par « Choisir », et un
// clic ailleurs sur la carte fait la même chose, à la souris seulement — le
// clavier a ses deux boutons. La touche « i » sur une carte ouvre sa fiche.

import * as React from "react";
import { Info, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import {
  ALL_CATEGORIES,
  filterProcedures,
  procedureCategories,
  volumeLabel,
} from "./procedureSearch";
import { ProcedureTileBody, procedureTileClass } from "./ProcedureTile";

interface Props {
  rows: SocleProcedureRow[];
  loading: boolean;
  /** Volume de demandes du mois par démarche (absent tant que non chargé). */
  counts?: Record<string, number>;
  selectedId: string;
  /** Démarche dont le snapshot est en cours de chargement depuis le Socle. */
  loadingId: string | null;
  /**
   * Organisme porteur retenu à l'étape 0, quand la question s'est posée. La
   * liste est alors bornée à ce que les DROITS de l'agent ouvrent pour lui (les
   * droits sont des couples) : l'écrire évite qu'il cherche en vain une démarche
   * qu'il connaît mais qu'il n'a pas le droit de consigner pour CET organisme.
   *
   * ⚠️ Ce n'est PAS un rattachement Socle : dans le référentiel, une démarche
   * appartient à UNE organisation, et Iris ne miroite que celles de la RACINE du
   * tenant (`buildSyncPlan`, `socle-proxy /v1/procedures/list`). Le libellé ne
   * doit donc jamais laisser croire que la liste est « les démarches de X ».
   */
  scopeLabel?: string | null;
  onSelect: (socleProcedureId: string) => void;
  /** Ouvre la fiche de la démarche (bouton « i », touche « i »). */
  onOpenFiche: (row: SocleProcedureRow) => void;
}

export function ProcedurePicker({
  rows, loading, counts, selectedId, loadingId, scopeLabel, onSelect, onOpenFiche,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(ALL_CATEGORIES);

  const chips = React.useMemo(() => procedureCategories(rows), [rows]);
  const visible = React.useMemo(
    () => filterProcedures(rows, { query, category }),
    [rows, query, category],
  );

  return (
    <div className="flex max-w-[1240px] flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label="Rechercher une démarche"
          placeholder="Rechercher une démarche — nom, catégorie, mot-clé"
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {chips.length > 2 ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Catégorie de démarche">
          {chips.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c.key)}
                className={cn(
                  "h-[30px] rounded-full border px-3 text-xs font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-secondary hover:bg-secondary",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-base font-semibold">Démarches disponibles</h3>
        <small className="text-xs text-muted-foreground">
          {loading ? "chargement…" : `${visible.length} sur ${rows.length}`}
        </small>
        {scopeLabel ? (
          <small className="text-xs text-muted-foreground">
            · celles que vos droits vous ouvrent pour <strong className="font-semibold">{scopeLabel}</strong>
          </small>
        ) : null}
      </div>

      {!loading && rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          {scopeLabel ? (
            <>
              Aucune démarche à consigner pour <strong>{scopeLabel}</strong> : vous n'y détenez
              le droit de création sur aucune des démarches proposables du tenant. Revenez à
              l'étape précédente pour choisir un autre organisme.
            </>
          ) : (
            <>
              Aucune démarche proposable pour ce tenant. Seules les démarches <strong>externes</strong>,
              dont le paramétrage est <strong>en production</strong> dans le Référentiel et qui sont
              <strong> dans leur période de publication</strong>, sont proposées ici — vérifiez leur
              état dans le référentiel, puis synchronisez-le.
            </>
          )}
        </div>
      ) : null}

      {!loading && rows.length > 0 && visible.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          Aucune démarche ne correspond à cette recherche.
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 min-[1400px]:grid-cols-3" aria-label="Démarches">
        {visible.map((row) => {
          const selected = row.socle_id === selectedId;
          const isLoading = row.socle_id === loadingId;
          const busy = loadingId !== null;
          const volume = volumeLabel(counts ? (counts[row.socle_id] ?? 0) : undefined);
          return (
            <li
              key={row.socle_id}
              // Clic sur la carte = « Choisir », à la souris. Les deux boutons
              // arrêtent la propagation : chacun fait son geste, pas deux.
              onClick={() => { if (!busy) onSelect(row.socle_id); }}
              onKeyDown={(e) => {
                if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault();
                  onOpenFiche(row);
                }
              }}
              className={cn(procedureTileClass(selected), "cursor-pointer", busy && "cursor-wait")}
            >
              <ProcedureTileBody
                name={row.name}
                category={row.category_name}
                type={row.type}
                publication={row.publication}
                volume={volume}
                actions={
                  <>
                    <button
                      type="button"
                      title="Fiche démarche (touche i)"
                      aria-label={`Fiche de la démarche « ${row.name} »`}
                      onClick={(e) => { e.stopPropagation(); onOpenFiche(row); }}
                      className={cn(
                        "flex size-[30px] items-center justify-center rounded-full border bg-card transition-[background-color,color,border-color,transform] active:scale-[0.94]",
                        selected
                          ? "border-primary/35 text-primary hover:bg-primary hover:text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary hover:text-primary",
                      )}
                    >
                      <Info className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={selected ? `Démarche choisie : ${row.name}` : `Choisir la démarche « ${row.name} »`}
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); onSelect(row.socle_id); }}
                      className={cn(
                        "inline-flex h-[26px] items-center gap-1 rounded-full px-[11px] text-xs font-bold transition-colors disabled:cursor-wait",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card text-foreground hover:border-secondary hover:bg-secondary",
                      )}
                    >
                      {isLoading ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                      {isLoading ? "Chargement" : selected ? "Choisie" : "Choisir"}
                    </button>
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
