-- ============================================================================
-- Les modèles de courriels VIENNENT DU SOCLE (décision PO du 2026-11-12).
--
-- Le Socle tient, par collectivité, les courriels envoyés aux usagers : les
-- courriels SYSTÈME (accusé de réception, avis de statut, clôture, code
-- d'accès, nouveau message — textes modifiables, jamais supprimables) et les
-- modèles CRÉÉS (proposés aux agents dans l'onglet Échanges, organisme par
-- organisme). Iris n'en garde qu'un MIROIR, rafraîchi à chaque
-- synchronisation du référentiel (`sync-socle-referentiel`), comme le serveur
-- d'envoi — motif `smtp_settings`.
--
-- Cette migration est ADDITIVE : le code en ligne continue de lire
-- `email_templates` jusqu'au déploiement ; la suppression des anciennes tables
-- est la migration suivante, appliquée avec le code.
--
-- Rejouable : IF EXISTS / OR REPLACE partout.
-- ============================================================================

-- 1. Le miroir. Une ligne par modèle servi au tenant pour l'application `iris`.
create table if not exists public.socle_email_templates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  -- Ligne du Socle : NULL pour un courriel système jamais personnalisé.
  socle_template_id  uuid,
  -- Clé stable du courriel système (`accuse_reception`…) : NULL pour un modèle créé.
  system_key         text,
  name               text not null,
  description        text,
  subject            text not null,
  body               text not null,
  -- Organismes Socle où un modèle CRÉÉ est proposé, nommément (pas de
  -- descendance) ; NULL pour un courriel système, qui vaut partout.
  socle_org_ids      uuid[],
  -- Variables que l'événement fournit (courriel système).
  variables          text[] not null default '{}',
  is_customized      boolean not null default false,
  socle_updated_at   timestamptz,
  synced_at          timestamptz not null default now(),
  constraint socle_email_templates_identity check (system_key is not null or socle_template_id is not null)
);

create unique index if not exists socle_email_templates_system_unique
  on public.socle_email_templates (organization_id, system_key) where system_key is not null;
create unique index if not exists socle_email_templates_custom_unique
  on public.socle_email_templates (organization_id, socle_template_id) where system_key is null;

comment on table public.socle_email_templates is
  'MIROIR des modèles de courriels du Socle (application iris) pour le tenant. Écrit uniquement par sync_email_templates_from_socle — aucune saisie dans Iris.';

-- 2. Lecture : tout membre du tenant (la liste « Modèle d'e-mail » des
--    Échanges). Aucune écriture cliente : le miroir ne se saisit pas.
alter table public.socle_email_templates enable row level security;
revoke all on table public.socle_email_templates from anon, authenticated;
grant select on table public.socle_email_templates to authenticated;

drop policy if exists socle_email_templates_select on public.socle_email_templates;
create policy socle_email_templates_select on public.socle_email_templates
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists socle_email_templates_service on public.socle_email_templates;
create policy socle_email_templates_service on public.socle_email_templates
  for all to service_role using (true) with check (true);

-- 3. Unique porte d'écriture : remplace d'un geste le miroir du tenant par ce
--    que sert le Socle. Miroir strict : un modèle retiré du Socle disparaît.
create or replace function public.sync_email_templates_from_socle(p_org_id uuid, p_templates jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'p_templates doit être un tableau JSON';
  end if;
  delete from public.socle_email_templates where organization_id = p_org_id;
  insert into public.socle_email_templates (
    organization_id, socle_template_id, system_key, name, description, subject, body,
    socle_org_ids, variables, is_customized, socle_updated_at
  )
  select p_org_id,
         (t->>'id')::uuid,
         t->>'key',
         t->>'name',
         t->>'description',
         t->>'subject',
         t->>'body',
         case when jsonb_typeof(t->'organization_ids') = 'array'
              then array(select jsonb_array_elements_text(t->'organization_ids'))::uuid[]
              else null end,
         coalesce(array(select jsonb_array_elements_text(t->'variables')), '{}'),
         coalesce((t->>'is_customized')::boolean, false),
         (t->>'updated_at')::timestamptz
  from jsonb_array_elements(p_templates) as t;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.sync_email_templates_from_socle(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_email_templates_from_socle(uuid, jsonb) to service_role;

-- 4. L'historique des échanges cite désormais un modèle du SOCLE : son
--    identifiant est un UUID Socle nu (aucune FK entre projets), et
--    `template_name` garde le nom lisible. Les lignes déjà écrites gardent
--    l'identifiant d'un ancien modèle Iris : historique, sans conséquence.
alter table public.request_emails drop constraint if exists request_emails_template_id_fkey;
comment on column public.request_emails.template_id is
  'Modèle de courriel employé : identifiant SOCLE nu (email_templates du Socle) depuis le 2026-11-12 ; avant, identifiant d''un modèle Iris supprimé. Lire template_name.';
