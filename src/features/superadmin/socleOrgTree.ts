// Arbre des organisations Socle miroir — logique pure, testée (réplique de
// l'ergonomie Clara/Socle : hiérarchie par parent, tri français).

export interface SocleOrgRow {
  socle_id: string;
  socle_parent_id: string | null;
  name: string;
  status: string;
  obsoleted_at: string | null;
}

export interface SocleOrgNode extends SocleOrgRow {
  children: SocleOrgNode[];
}

export function buildSocleOrgTree(rows: SocleOrgRow[]): SocleOrgNode[] {
  const nodes = new Map<string, SocleOrgNode>(
    rows.map((r) => [r.socle_id, { ...r, children: [] }]),
  );
  const roots: SocleOrgNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.socle_parent_id ? nodes.get(node.socle_parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: SocleOrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export function collectIds(nodes: SocleOrgNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SocleOrgNode[]) => {
    for (const n of list) {
      out.push(n.socle_id);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
