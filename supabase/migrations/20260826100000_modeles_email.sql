-- ============================================================================
-- Modèles d'e-mail (décision PO 2026-08-26) — paramétrage administré par les
-- administrateurs de tenant, consultable par tous ses membres.
--
-- Réf : docs/architecture-proposee.md §7 (le rôle admin porte déjà
-- « motifs/délais/modèles ») et décision D7 (« le canal d'origine porte la
-- communication » : Iris produit le TEXTE, Clara produit le courrier). D'où le
-- vocabulaire retenu : « modèle d'e-mail », jamais « modèle de courrier » —
-- « courrier » désigne l'objet métier de Clara dans toute la gamme.
--
-- Contenu : TEXTE BRUT à variables `{{groupe.cle}}`, un objet et un corps.
-- Ni HTML, ni PDF : la mise en page d'un pli est le métier de Clara (Q8).
--
-- ÉCRITURE PAR POLICIES, PAS PAR RPC — à rebours des tables `permission_*`
-- voisines, et c'est délibéré. Le projet retient la RPC quand l'écriture est
-- COMPOSITE, quand un invariant est inexprimable en `with check`, quand une
-- policy d'écriture bouclerait sur le moteur de droits, ou quand une colonne
-- est un secret (docs/data-model.md §Principes). Aucun de ces cas ici : une
-- ligne, un prédicat de ligne simple, aucune lecture de cette table par le
-- moteur de droits, aucun secret. La seule règle qui dépasse le prédicat — la
-- validité des variables — est portée par un TRIGGER, qui ne se contourne pas
-- davantage qu'une RPC.
--
-- La vague 2 (activation organisation par organisation) n'exigera AUCUNE
-- modification de cette table : une satellite `email_template_organizations`
-- au motif de `permission_profile_organizations`. C'est à ce moment que
-- l'écriture deviendra composite et qu'une RPC `save_email_template` se
-- justifiera.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catalogue des variables — un CONTRAT, pas une suggestion
--
-- Jumeau exact de `TEMPLATE_VARIABLES` (src/features/templates/templates.ts).
-- Chaque clé correspond à une donnée qu'Iris possède réellement : colonne de
-- `requests`, identité figée dans `requester_snapshot`, ou événement du
-- journal. Ajouter une variable = une migration, à dessein.
-- ----------------------------------------------------------------------------

create or replace function public.email_template_variables()
returns text[] language sql immutable set search_path = '' as $fn$
  select array[
    -- Usager : depuis requests.requester_snapshot.declared (identité figée au
    -- dépôt), normalisée côté front par requesterIdentity().
    'usager.civilite',
    'usager.prenom',
    'usager.nom',
    'usager.nom_complet',
    'usager.raison_sociale',
    'usager.courriel',
    'usager.telephone',
    'usager.adresse',
    -- Demande : colonnes de requests, libellés français côté front.
    'demande.reference',
    'demande.objet',
    'demande.description',
    'demande.statut',
    'demande.priorite',
    'demande.demarche',        -- socle_procedure_label (« type de demande »)
    'demande.categorie',       -- socle_category_label
    'demande.destinataire',    -- socle_organization_label
    'demande.canal',
    'demande.date_depot',      -- received_at (date d'origine, immuable)
    'demande.date_instruction',-- ⚠️ pas une colonne : request_events, cf. §doc
    'demande.date_cloture',    -- closed_at
    'demande.date_echeance',   -- due_at
    'demande.motif_cloture',
    -- Qui traite, et pour qui.
    'agent.nom',
    'organisation.nom'
  ];
$fn$;
comment on function public.email_template_variables() is
  'Catalogue FIGÉ des variables autorisées dans un modèle d''e-mail. Jumeau de TEMPLATE_VARIABLES (front). Ajouter une variable = une migration : le catalogue est un contrat.';
revoke execute on function public.email_template_variables() from public, anon, authenticated;

-- Variables citées par un texte mais absentes du catalogue. Le motif n'accepte
-- que `{{groupe.cle}}` en minuscules, points et tirets bas — tout le reste est
-- du texte ordinaire et n'est même pas vu comme une variable.
create or replace function public.email_template_unknown_variables(p_text text)
returns text[] language sql immutable set search_path = '' as $fn$
  select coalesce(array_agg(distinct x.key), '{}'::text[])
    from (
      select m[1] as key
        from regexp_matches(coalesce(p_text, ''), '\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}', 'g') m
    ) x
   where not (x.key = any(public.email_template_variables()));
$fn$;
comment on function public.email_template_unknown_variables(text) is
  'Variables `{{groupe.cle}}` citées par un texte et absentes du catalogue. Interne : alimente la garde t03.';
revoke execute on function public.email_template_unknown_variables(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Table
-- ----------------------------------------------------------------------------

create table if not exists public.email_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  description     text,
  subject         text not null check (btrim(subject) <> ''),
  body            text not null check (btrim(body) <> ''),
  -- Verrou optimiste (motif RM-56 de permission_profiles) : objet de
  -- paramétrage édité dans un dialogue, potentiellement à plusieurs
  -- administrateurs. Sans RPC il se tient côté requête :
  -- `update … where id = ? and version = ?` → 0 ligne = conflit.
  version         int  not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  updated_by      uuid references public.users(id)
);

comment on table public.email_templates is
  'Modèles d''e-mail du tenant : texte brut à variables `{{groupe.cle}}` (objet + corps). Administrés par les administrateurs, lisibles par tout membre. La validité des variables est tenue par t03_email_templates_guard_variables.';

-- Deux modèles ne peuvent pas porter le même nom dans un tenant, à la casse et
-- aux espaces de bordure près (motif de permission_profiles).
create unique index if not exists email_templates_name_idx
  on public.email_templates (organization_id, lower(btrim(name)));
create index if not exists email_templates_org_idx
  on public.email_templates (organization_id, name);

drop trigger if exists t02_email_templates_updated_at on public.email_templates;
create trigger t02_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Garde des variables — la seule règle qui dépasse le prédicat de ligne.
--
-- Un modèle contenant `{{demande.inexistant}}` produirait plus tard un e-mail
-- troué, chez l'usager, sans que personne s'en aperçoive à la saisie. La garde
-- vit donc au SERVEUR : l'écran ne fait que la refléter en amont.
-- ----------------------------------------------------------------------------

create or replace function public.email_templates_guard_variables()
returns trigger language plpgsql set search_path = '' as $fn$
declare
  v_unknown text[];
begin
  v_unknown := public.email_template_unknown_variables(new.subject);
  if array_length(v_unknown, 1) is not null then
    raise exception 'Variable inconnue dans l''objet : {{%}}.', array_to_string(v_unknown, '}}, {{');
  end if;

  v_unknown := public.email_template_unknown_variables(new.body);
  if array_length(v_unknown, 1) is not null then
    raise exception 'Variable inconnue dans le corps : {{%}}.', array_to_string(v_unknown, '}}, {{');
  end if;
  return new;
end;
$fn$;
revoke execute on function public.email_templates_guard_variables() from public, anon, authenticated;

drop trigger if exists t03_email_templates_guard_variables on public.email_templates;
create trigger t03_email_templates_guard_variables
  before insert or update on public.email_templates
  for each row execute function public.email_templates_guard_variables();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.email_templates enable row level security;

-- Lecture : tout membre du tenant. Un modèle n'est pas un secret
-- d'administration — un agent devra le choisir depuis une demande (vague 2), et
-- rien ne justifie de le lui cacher d'ici là.
drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated using (public.is_org_member(organization_id));

-- Écriture : administrateur QUELQUE PART dans le tenant — un modèle vaut pour
-- tout le tenant, il n'est rattaché à aucune organisation Socle (la vague 2
-- introduira ce rattachement, et c'est alors `has_admin_scope` qui s'appliquera
-- au périmètre proposé).
drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates
  for insert to authenticated
  with check (
    public.is_org_admin_anywhere(organization_id)
    and created_by = (select auth.uid())
  );

drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates
  for update to authenticated
  using (public.is_org_admin_anywhere(organization_id))
  with check (public.is_org_admin_anywhere(organization_id));

drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates
  for delete to authenticated
  using (public.is_org_admin_anywhere(organization_id));

drop policy if exists email_templates_service on public.email_templates;
create policy email_templates_service on public.email_templates
  for all to service_role using (true) with check (true);
