-- ============================================================================
-- Documents d'instruction et courriers (onglet « Documents » de la fiche).
--
-- Jusqu'ici, `request_attachments` ne portait qu'une seule nature de pièce :
-- ce que l'USAGER a déposé (rattaché à une exigence du formulaire par
-- `form_field_key`), plus les fichiers joints à un échange sortant
-- (`email_id`). Le métier en demande deux autres :
--
--   · les **pièces d'instruction**, produites par le service — INTERNES (une
--     note d'analyse, un avis de service : elles ne quittent jamais Iris) ou
--     EXTERNES (transmissibles à l'usager) ;
--   · les **courriers**, générés depuis un modèle Word de la démarche.
--
-- D'où `kind`, et non une table de plus : ce sont les mêmes objets (un fichier
-- dans le bucket privé, une ligne, un RLS déjà écrit). Une table parallèle
-- aurait dupliqué les policies, la purge RGPD et la qualification.
--
-- ⚠️ **L'INVARIANT DE CE LOT** : un document `instruction_interne` ne peut
-- JAMAIS être joint à un échange sortant. C'est le miroir de la règle des notes
-- internes (« le corps d'une note interne ne sort jamais d'Iris »), et il est
-- gardé par un TRIGGER — pas par l'UI, pas par l'edge function seule.
-- ============================================================================

alter table public.request_attachments
  add column if not exists kind text not null default 'demande',
  -- Génération : d'où vient ce document, quand, par qui. Le modèle est une
  -- ressource SOCLE → UUID nu + libellé figé, jamais de FK inter-projet.
  add column if not exists template_socle_id uuid,
  add column if not exists template_label text,
  add column if not exists generated_at timestamptz,
  add column if not exists generated_by uuid references public.users(id),
  -- Une pièce d'échange qui est la COPIE d'un document du dossier : le même
  -- objet de stockage, une ligne de plus. Sans ce lien, l'onglet Échanges
  -- montrerait un fichier orphelin, et joindre deux fois le même courrier
  -- serait impossible (`email_id` est simple).
  add column if not exists source_attachment_id uuid references public.request_attachments(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.request_attachments'::regclass
       and conname  = 'request_attachments_kind_check'
  ) then
    alter table public.request_attachments
      add constraint request_attachments_kind_check
      check (kind in ('demande', 'instruction_interne', 'instruction_externe', 'courrier'));
  end if;
end
$$;

comment on column public.request_attachments.kind is
  'Nature : demande (déposée par l''usager ou jointe à un échange) | instruction_interne (ne sort JAMAIS) | instruction_externe | courrier.';
comment on column public.request_attachments.source_attachment_id is
  'Pièce d''échange qui est la copie d''un document du dossier (même storage_path).';

create index if not exists request_attachments_kind_idx
  on public.request_attachments (request_id, kind)
  where email_id is null;

-- ----------------------------------------------------------------------------
-- t05 — un document interne ne sort jamais.
-- ----------------------------------------------------------------------------
-- Rattacher une pièce à un échange, c'est poser `email_id`. La garde tient donc
-- sur (kind, email_id), à l'insertion comme à la mise à jour, et vaut aussi
-- pour le `service_role` : l'edge function d'envoi n'est pas plus digne de
-- confiance que le navigateur sur ce point précis.
create or replace function public.attachments_internal_never_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_id is not null and new.kind = 'instruction_interne' then
    raise exception 'Un document interne à l''instruction ne peut pas être envoyé à l''usager.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.attachments_internal_never_sent() from public, anon, authenticated;

drop trigger if exists t05_attachments_internal_never_sent on public.request_attachments;
create trigger t05_attachments_internal_never_sent
  before insert or update on public.request_attachments
  for each row execute function public.attachments_internal_never_sent();

-- ----------------------------------------------------------------------------
-- start_request_email — joindre un DOCUMENT DÉJÀ AU DOSSIER
-- ----------------------------------------------------------------------------
-- Deux formes de pièce jointe désormais :
--   · `{ storage_path, file_name, … }` — un fichier que le navigateur vient de
--     téléverser (inchangé) ;
--   · `{ attachment_id }` — un document du dossier. Le serveur lit alors la
--     ligne LUI-MÊME : ni le chemin, ni le nom, ni la nature ne viennent du
--     navigateur, qui pourrait sinon faire passer un interne pour un externe.
--
-- ⚠️ `CREATE OR REPLACE` re-accorde EXECUTE à PUBLIC : les révocations sont
-- rejouées ci-dessous (piège vécu chez Clara).
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
  src   public.request_attachments%rowtype;
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

  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if nullif(a ->> 'attachment_id', '') is not null then
      -- Document du dossier : la vérité est en base, pas dans le payload.
      select * into src
        from public.request_attachments
       where id = (a ->> 'attachment_id')::uuid
         and request_id = p_request_id;
      if not found then
        raise exception 'Pièce jointe introuvable dans cette demande.';
      end if;
      if src.kind = 'instruction_interne' then
        raise exception 'Un document interne à l''instruction ne peut pas être envoyé à l''usager.'
          using errcode = 'check_violation';
      end if;

      insert into public.request_attachments (
        organization_id, request_id, storage_path, file_name, mime_type, file_size,
        copy_status, uploaded_by, email_id, kind, source_attachment_id,
        template_socle_id, template_label
      ) values (
        v_org, p_request_id, src.storage_path, src.file_name, src.mime_type, src.file_size,
        'copied', p_sent_by, v_id, src.kind, src.id,
        src.template_socle_id, src.template_label
      );
    else
      -- Fichier téléversé pour cet envoi (policy storage : droit d'instruction).
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
    end if;
  end loop;

  return v_id;
end;
$fn$;

comment on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb) is
  'Ouvre un échange sortant en statut « en_cours » AVEC ses pièces jointes (fichiers téléversés ou documents du dossier, lus en base), dans une seule transaction. Interne : appelée par la seule edge function send-request-email.';
revoke execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- Lecture des chemins d'un document à joindre (edge function d'envoi).
-- ----------------------------------------------------------------------------
-- L'edge function doit télécharger le fichier pour le mettre dans l'e-mail :
-- elle a besoin du chemin, qu'elle ne doit surtout pas accepter du navigateur.
-- `SECURITY INVOKER` : le RLS de `request_attachments` s'applique.
create or replace function public.request_attachment_paths(p_request_id uuid, p_ids uuid[])
returns table (attachment_id uuid, path text, name text, mime text, size bigint, nature text)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.storage_path, a.file_name, a.mime_type, a.file_size, a.kind
    from public.request_attachments a
   where a.request_id = p_request_id
     and a.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;

comment on function public.request_attachment_paths(uuid, uuid[]) is
  'Chemins des pièces d''une demande, pour l''envoi : SECURITY INVOKER, donc borné au périmètre du lecteur par le RLS.';
revoke execute on function public.request_attachment_paths(uuid, uuid[]) from public, anon;
grant  execute on function public.request_attachment_paths(uuid, uuid[]) to authenticated, service_role;
