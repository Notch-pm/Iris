-- ============================================================================
-- Échanges avec l'usager — un e-mail envoyé depuis la fiche demande.
--
-- POURQUOI UNE TABLE, ET PAS `request_messages` : celle-ci n'accepte qu'un
-- `kind = 'note_interne'` (check à une seule valeur), et l'invariant « les notes
-- internes ne quittent JAMAIS Iris » est répété dans le SQL, docs/data-model.md,
-- architecture-proposee.md (risque R-H5) et l'UI. Un message qui part chez un
-- fournisseur de messagerie est l'exact contraire : il lui faut son objet.
--
-- CE QUI SORT D'IRIS : la doctrine de `_shared/email/notifications.ts` (pas
-- d'identité d'usager, pas de description, pas de pièces) vise les e-mails de
-- NOTIFICATION, qui vont aux AGENTS. Elle ne s'applique pas à une réponse
-- délibérée à l'usager, qui est la personne concernée. Reste global, en
-- revanche : le CORPS d'une note interne ne sort jamais.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. request_emails — la trace de ce qui est parti
-- ----------------------------------------------------------------------------

create table if not exists public.request_emails (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id      uuid not null references public.requests(id) on delete cascade,
  sent_by         uuid not null references public.users(id),
  to_email        text not null check (btrim(to_email) <> ''),
  subject         text not null check (btrim(subject) <> ''),
  body            text not null check (btrim(body) <> ''),
  template_id     uuid references public.email_templates(id) on delete set null,
  template_name   text,
  status          text not null default 'en_cours'
                  check (status in ('en_cours', 'envoye', 'echec')),
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists request_emails_request_idx
  on public.request_emails (request_id, created_at desc);

comment on table public.request_emails is
  'Échanges SORTANTS vers l''usager (courriel). Le corps est celui qui est RÉELLEMENT parti : aucune écriture cliente, la seule porte est l''edge function send-request-email. Aucune suppression non plus — un e-mail parti ne se dé-envoie pas (même raisonnement que « aucune suppression de demande ») ; la purge RGPD reste à écrire (procédure service_role dédiée) : elle devra lever l''immuabilité de request_events, seule chose qui empêche aujourd''hui de supprimer une demande — request_emails, lui, cascade déjà.';
comment on column public.request_emails.to_email is
  'Adresse RÉELLEMENT servie, figée. Résolue côté serveur depuis requester_snapshot, jamais acceptée du navigateur.';
comment on column public.request_emails.template_name is
  'Nom du modèle FIGÉ : template_id passe à null si le modèle est supprimé (promesse affichée à l''administrateur), le nom reste lisible dans l''échange.';

-- Cohérence de périmètre : helper commun aux satellites (20260820100200).
drop trigger if exists t01_request_emails_check_org on public.request_emails;
create trigger t01_request_emails_check_org
  before insert on public.request_emails
  for each row execute function public.satellite_check_request_org();

-- ----------------------------------------------------------------------------
-- 2. Les pièces jointes réutilisent request_attachments
--
-- Une colonne, pas une table : une pièce jointe EST une pièce de la demande.
-- Tout l'existant s'applique alors tel quel — policy d'insertion
-- (uploaded_by = auth.uid() ET droit d'instruction, RM-13), policy storage
-- (can_process_request sur le 2e segment du chemin), convention de chemin,
-- URLs signées, vignettes.
-- ----------------------------------------------------------------------------

alter table public.request_attachments
  add column if not exists email_id uuid references public.request_emails(id) on delete cascade;

create index if not exists request_attachments_email_idx
  on public.request_attachments (email_id) where email_id is not null;

comment on column public.request_attachments.email_id is
  'NULL = pièce déposée par l''usager ou par l''ingestion (« Pièces de la demande »). Non-NULL = pièce jointe à un échange sortant, dont elle suit le sort. La trace d''un envoi est protégée par l''absence de policy DELETE sur request_emails, pas par cette FK.';

-- ----------------------------------------------------------------------------
-- 3. RLS — lecture large, écriture par le serveur seul
-- ----------------------------------------------------------------------------

alter table public.request_emails enable row level security;

-- Qui peut consulter la demande voit ses échanges : le RLS de `requests` fait
-- tout le filtrage (motif request_attachments_select). Un échange avec l'usager
-- n'est pas une note interne — rien à cacher à qui instruit le dossier.
drop policy if exists request_emails_select on public.request_emails;
create policy request_emails_select on public.request_emails
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_emails.request_id));

-- AUCUNE policy INSERT/UPDATE/DELETE cliente, délibérément :
--   . le corps enregistré doit être celui qui est réellement parti — accepter un
--     INSERT du navigateur ferait de l'échange une déclaration, pas une trace ;
--   . un e-mail parti ne se dé-envoie pas.
drop policy if exists request_emails_service on public.request_emails;
create policy request_emails_service on public.request_emails
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4. Les deux RPC de service (motif claim/settle_notification_email)
--
-- L'échange est écrit AVANT l'envoi. Écrire après laisserait un trou : l'e-mail
-- parti et aucune trace si l'écriture échoue — pire qu'un objet orphelin. Ici un
-- échec laisse une ligne 'echec' avec son motif, lisible dans l'onglet.
-- ----------------------------------------------------------------------------

create or replace function public.start_request_email(
  p_request_id    uuid,
  p_sent_by       uuid,
  p_to_email      text,
  p_subject       text,
  p_body          text,
  p_template_id   uuid  default null,
  p_template_name text  default null,
  p_attachments   jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_org uuid;
  v_id  uuid;
  a     jsonb;
begin
  select r.organization_id into v_org from public.requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'Échange : demande introuvable.';
  end if;

  insert into public.request_emails (
    organization_id, request_id, sent_by, to_email, subject, body,
    template_id, template_name
  ) values (
    v_org, p_request_id, p_sent_by, btrim(p_to_email), p_subject, p_body,
    p_template_id, nullif(btrim(coalesce(p_template_name, '')), '')
  )
  returning id into v_id;

  -- Les pièces sont déjà dans le bucket (téléversées par le navigateur, sous une
  -- policy storage qui exige déjà le droit d'instruction) ; on ne fait que les
  -- déclarer, rattachées à cet échange.
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      copy_status, uploaded_by, email_id
    ) values (
      v_org, p_request_id,
      a ->> 'storage_path',
      a ->> 'file_name',
      nullif(a ->> 'mime_type', ''),
      nullif(a ->> 'file_size', '')::bigint,
      'copied', p_sent_by, v_id
    );
  end loop;

  return v_id;
end;
$fn$;

comment on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb) is
  'Ouvre un échange sortant en statut « en_cours » AVEC ses pièces jointes, dans une seule transaction. Interne : appelée par la seule edge function send-request-email.';
revoke execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  to service_role;

create or replace function public.settle_request_email(
  p_id uuid, p_ok boolean, p_error text default null
) returns void
language sql security definer set search_path = '' as $fn$
  update public.request_emails
     set status  = case when p_ok then 'envoye' else 'echec' end,
         sent_at = case when p_ok then now() else sent_at end,
         error   = case when p_ok then null
                        else left(nullif(btrim(coalesce(p_error, '')), ''), 500) end
   where id = p_id;
$fn$;

comment on function public.settle_request_email(uuid, boolean, text) is
  'Clôt un échange sortant : « envoye » + sent_at, ou « echec » + motif tronqué à 500 caractères. Interne : service_role uniquement.';
revoke execute on function public.settle_request_email(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.settle_request_email(uuid, boolean, text) to service_role;

-- La fonction edge vérifie le droit d'INSTRUCTION de l'appelant avec l'enveloppe
-- générique du moteur de droits. Elle est révoquée des rôles clients (la garde
-- anti-sondage, elle, est dans `user_has_request_right`, qui protège un appel
-- client) ; le grant service_role est ici EXPLICITE plutôt que laissé aux
-- privilèges par défaut, pour qu'un futur CREATE OR REPLACE ne le rende pas
-- silencieux.
grant execute on function public.request_right_for(uuid,uuid,uuid,uuid,text) to service_role;
