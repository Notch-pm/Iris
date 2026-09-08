-- ============================================================================
-- Lien d'une pièce vers l'USAGER — `request_attachments.socle_contact_id`
-- (lot 3 du chantier documents, 2026-09-08).
--
-- POURQUOI. Un document était la propriété d'une demande, jamais d'une
-- personne : « toutes les pièces de M. X » n'existait pas autrement qu'en
-- parcourant ses demandes une à une. Or c'est une question que le service se
-- pose (fiche usager), et c'est celle du droit d'accès RGPD.
--
-- COMMENT. Une colonne DÉNORMALISÉE, écrite par TRIGGER depuis
-- `requests.socle_contact_id` — jamais par un client, dont toute valeur est
-- écrasée (t06, BEFORE INSERT) — et RESYNCHRONISÉE quand la demande est
-- rapprochée après coup (t19, AFTER UPDATE OF socle_contact_id : le cas de
-- l'anomalie `usager_a_creer_dans_socle` régularisée). Aucune FK : l'usager
-- vit dans le Socle (UUID nu, invariant).
--
-- Ce que la colonne ne change PAS : le RLS. La lecture d'une pièce suit
-- toujours sa demande (`EXISTS requests`) ; la colonne sert à la RETROUVER,
-- pas à l'ouvrir.
-- ============================================================================

alter table public.request_attachments add column if not exists socle_contact_id uuid;
comment on column public.request_attachments.socle_contact_id is
  'Usager Socle de la demande (UUID nu, sans FK). DÉNORMALISÉ depuis requests.socle_contact_id par trigger (t06 à l''insertion, t19 au rapprochement postérieur) — jamais écrit par un client.';

-- ----------------------------------------------------------------------------
-- t06 — à l'insertion, la pièce hérite de l'usager de sa demande (t01 a déjà
-- vérifié que la demande existe et est du même tenant).
-- ----------------------------------------------------------------------------
create or replace function public.attachments_set_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select r.socle_contact_id into new.socle_contact_id
    from public.requests r where r.id = new.request_id;
  return new;
end;
$$;
revoke execute on function public.attachments_set_contact() from public, anon, authenticated;

drop trigger if exists t06_attachments_set_contact on public.request_attachments;
create trigger t06_attachments_set_contact
  before insert on public.request_attachments
  for each row execute function public.attachments_set_contact();

-- ----------------------------------------------------------------------------
-- t19 — la demande est rapprochée (ou détachée) après coup : ses pièces suivent.
-- ----------------------------------------------------------------------------
create or replace function public.requests_sync_attachment_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.request_attachments a
     set socle_contact_id = new.socle_contact_id
   where a.request_id = new.id
     and a.socle_contact_id is distinct from new.socle_contact_id;
  return new;
end;
$$;
revoke execute on function public.requests_sync_attachment_contact() from public, anon, authenticated;

drop trigger if exists t19_requests_sync_attachment_contact on public.requests;
create trigger t19_requests_sync_attachment_contact
  after update of socle_contact_id on public.requests
  for each row
  when (old.socle_contact_id is distinct from new.socle_contact_id)
  execute function public.requests_sync_attachment_contact();

-- ----------------------------------------------------------------------------
-- Reprise des lignes existantes.
-- ----------------------------------------------------------------------------
update public.request_attachments a
   set socle_contact_id = r.socle_contact_id
  from public.requests r
 where r.id = a.request_id
   and a.socle_contact_id is distinct from r.socle_contact_id;

-- « Les documents de cet usager » : ni les internes (règle absolue), ni les
-- copies jointes à un échange (`source_attachment_id` : l'original est déjà
-- listé), les plus récents d'abord.
create index if not exists request_attachments_contact_idx
  on public.request_attachments (socle_contact_id, created_at desc)
  where socle_contact_id is not null
    and kind <> 'instruction_interne'
    and source_attachment_id is null;
