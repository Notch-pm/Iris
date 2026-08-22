// Périmètre d'organisations d'un profil (RM-25 : sémantique sous-arbre
// implicite — cocher un nœud inclut ses organisations rattachées, l'expansion
// est faite côté serveur). Ergonomie alignée sur l'arbre superadmin
// (`SocleOrganizationTree`) : tout déplié, chevrons, badge Obsolète. Un nœud
// obsolète n'est plus PROPOSÉ à l'ajout (RM-30) mais reste affiché, coché et
// togglable-au-retrait s'il fait déjà partie du profil.

import * as React from "react";
import { ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  buildSocleOrgTree,
  collectIds,
  type SocleOrgNode,
  type SocleOrgRow,
} from "@/features/superadmin/socleOrgTree";

/**
 * Sous-arbre filtré par nom : un nœud est conservé s'il correspond lui-même
 * OU si l'un de ses descendants correspond (préserve la chaîne des
 * ancêtres, sinon un résultat profond perdrait son contexte).
 */
export function filterOrgNodes(nodes: SocleOrgNode[], query: string): SocleOrgNode[] {
  const q = query.trim().toLowerCase();
  if (q === "") return nodes;
  const walk = (list: SocleOrgNode[]): SocleOrgNode[] =>
    list.reduce<SocleOrgNode[]>((acc, node) => {
      const children = walk(node.children);
      if (node.name.toLowerCase().includes(q) || children.length > 0) {
        acc.push({ ...node, children });
      }
      return acc;
    }, []);
  return walk(nodes);
}

/**
 * Organisations réellement couvertes par la sélection (RM-25 : chaque nœud
 * coché inclut tout son sous-arbre) — calculé sur l'arbre COMPLET, jamais sur
 * l'arbre filtré par la recherche, pour un compteur toujours exact.
 */
export function coveredOrganizationIds(nodes: SocleOrgNode[], selected: string[]): Set<string> {
  const selectedSet = new Set(selected);
  const out = new Set<string>();
  const walk = (list: SocleOrgNode[]) => {
    for (const node of list) {
      if (selectedSet.has(node.socle_id)) {
        for (const id of collectIds([node])) out.add(id);
      } else {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

interface OrgScopePickerProps {
  rows: SocleOrgRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function OrgScopePicker({ rows, selected, onChange }: OrgScopePickerProps) {
  const [query, setQuery] = React.useState("");
  const nodes = React.useMemo(() => buildSocleOrgTree(rows), [rows]);
  const filteredNodes = React.useMemo(() => filterOrgNodes(nodes, query), [nodes, query]);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const coveredCount = React.useMemo(
    () => coveredOrganizationIds(nodes, selected).size,
    [nodes, selected],
  );

  React.useEffect(() => {
    setExpanded(new Set(collectIds(nodes)));
  }, [nodes]);

  const toggle = React.useCallback(
    (id: string, checked: boolean) => {
      const next = new Set(selectedSet);
      if (checked) next.add(id);
      else next.delete(id);
      onChange([...next]);
    },
    [selectedSet, onChange],
  );

  const toggleExpand = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
        Aucune organisation synchronisée pour ce tenant — la synchronisation avec le Socle est
        automatique (quotidienne). Si le problème persiste, contactez le support.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Cocher une organisation inclut automatiquement toutes les organisations qui en
        dépendent (son sous-arbre complet).
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Rechercher une organisation"
            className="h-8 pl-8 text-xs"
            placeholder="Rechercher une organisation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="text-xs font-semibold text-muted-foreground">
          Ce périmètre couvrira {coveredCount} organisation{coveredCount > 1 ? "s" : ""}
        </p>
      </div>
      {filteredNodes.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucune organisation ne correspond à cette recherche.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-auto rounded-[14px] border border-border p-2">
          {filteredNodes.map((node) => (
            <OrgScopeRow
              key={node.socle_id}
              node={node}
              depth={0}
              selected={selectedSet}
              expanded={expanded}
              onToggle={toggle}
              onToggleExpand={toggleExpand}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrgScopeRow({
  node, depth, selected, expanded, onToggle, onToggleExpand,
}: {
  node: SocleOrgNode;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleExpand: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.socle_id);
  const isObsolete = node.obsoleted_at !== null;
  const isChecked = selected.has(node.socle_id);
  const isDisabled = isObsolete && !isChecked;
  const inputId = `org-scope-${node.socle_id}`;

  return (
    <li>
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-1" style={{ marginLeft: depth * 20 }}>
        <button
          type="button"
          aria-label={hasChildren ? (isOpen ? "Réduire" : "Développer") : undefined}
          onClick={() => hasChildren && onToggleExpand(node.socle_id)}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
            hasChildren ? "hover:bg-muted" : "invisible",
          )}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
        <input
          type="checkbox"
          id={inputId}
          checked={isChecked}
          disabled={isDisabled}
          title={isDisabled ? "Organisation obsolète — non proposée à l'ajout dans un nouveau périmètre." : undefined}
          onChange={(e) => onToggle(node.socle_id, e.target.checked)}
          className="size-4 shrink-0 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <label htmlFor={inputId} className={cn("truncate text-sm", isObsolete && "text-muted-foreground")}>
          {node.name}
        </label>
        {isObsolete ? (
          <Badge variant="secondary" className="shrink-0">
            Obsolète
          </Badge>
        ) : null}
      </div>
      {hasChildren && isOpen ? (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <OrgScopeRow
              key={child.socle_id}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
