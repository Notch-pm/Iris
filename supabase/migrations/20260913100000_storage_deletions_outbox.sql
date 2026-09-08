-- ============================================================================
-- Purge et outbox de suppression des objets du bucket des pièces
-- (lot 4 du chantier documents, 2026-09-08).
--
-- LE PROBLÈME. Un objet du bucket ne partait JAMAIS : supprimer une ligne
-- `request_attachments` (policy DELETE admin, future purge RGPD) laissait le
-- fichier ; les fichiers reçus en zone d'attente et jamais rattachés
-- (brouillon abandonné, envoi échoué) s'accumulaient. C'est le « vrai reste
-- RGPD » que Clara a documenté sans le traiter, et un coût qui ne redescend
-- jamais.
--
-- LA RÉPONSE, en trois pièces, toutes drainées par l'edge function
-- `attachments-maintenance` sur cron (motif `notifications-mailer` : la base
-- décide, l'edge exécute — un objet ne se retire que par l'API Storage, jamais
-- par un DELETE SQL sur storage.objects) :
--
--   1. OUTBOX `storage_deletions` — une ligne `request_attachments` supprimée
--      enfile son objet (trigger AFTER DELETE), SAUF si une autre ligne le
--      référence encore (« joindre à un échange » = deux lignes, un objet :
--      il ne part qu'avec la dernière). Rejeu avec recul exponentiel, abandon
--      après 8 tentatives (l'erreur reste lisible).
--   2. PURGE de la zone d'attente — les lignes `attachment_uploads` expirées
--      sans rattachement ou retirées : objet ET ligne. Les lignes CONSOMMÉES
--      sont conservées 30 jours (le rejeu idempotent d'un dépôt partenaire
--      relit les empreintes de ses pièces par elles), puis la ligne seule
--      part : l'objet appartient désormais à `request_attachments`.
--   3. RÉCONCILIATION (mode manuel `?mode=reconcile`) — les objets que plus
--      aucune ligne ne décrit vont à l'outbox ; les pièces sans objet passent
--      en `copy_status = 'error'`.
--
-- ⚠️ L'outbox n'écrit JAMAIS dans `request_events` : le journal est immuable
-- (`t01`), et une suppression de pièce peut arriver au milieu d'une purge de
-- demande. La purge RGPD des demandes reste un chantier distinct — celui-ci
-- la rend seulement possible sans laisser d'orphelin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. L'outbox
-- ----------------------------------------------------------------------------
create table if not exists public.storage_deletions (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null default 'request-attachments',
  storage_path    text not null,
  organization_id uuid,
  reason          text not null
                    check (reason in ('attachment_deleted', 'upload_expired', 'upload_discarded', 'orphan')),
  enqueued_at     timestamptz not null default now(),
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  done_at         timestamptz,
  last_error      text
);
comment on table public.storage_deletions is
  'Outbox de suppression des objets du bucket des pièces : la base enfile (trigger, purge, réconciliation), l''edge function attachments-maintenance retire par l''API Storage. Jamais de DELETE SQL sur storage.objects.';

-- Un objet n'est enfilé qu'une fois tant qu'il n'est pas retiré.
create unique index if not exists storage_deletions_pending_key
  on public.storage_deletions (bucket, storage_path)
  where done_at is null;
create index if not exists storage_deletions_due_idx
  on public.storage_deletions (next_attempt_at)
  where done_at is null;

alter table public.storage_deletions enable row level security;
drop policy if exists storage_deletions_service on public.storage_deletions;
create policy storage_deletions_service on public.storage_deletions
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2. Le trigger — une pièce supprimée emporte son objet, si elle était la
--    dernière à le référencer.
-- ----------------------------------------------------------------------------
create or replace function public.attachments_enqueue_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.request_attachments a
     where a.storage_path = old.storage_path and a.id <> old.id
  ) then
    return old;
  end if;
  insert into public.storage_deletions (bucket, storage_path, organization_id, reason)
  values ('request-attachments', old.storage_path, old.organization_id, 'attachment_deleted')
  on conflict (bucket, storage_path) where done_at is null do nothing;
  return old;
end;
$$;
revoke execute on function public.attachments_enqueue_deletion() from public, anon, authenticated;

drop trigger if exists t07_attachments_enqueue_deletion on public.request_attachments;
create trigger t07_attachments_enqueue_deletion
  after delete on public.request_attachments
  for each row execute function public.attachments_enqueue_deletion();

-- ----------------------------------------------------------------------------
-- 3. Les RPC de service (toutes service_role, aucune EXECUTE cliente)
-- ----------------------------------------------------------------------------

-- Réclame un lot d'objets à retirer et avance leur prochain essai DANS LA MÊME
-- instruction (for update skip locked) : deux passages concurrents ne
-- retirent jamais deux fois. Recul : 1, 2, 4… minutes, abandon à 8 essais.
create or replace function public.claim_storage_deletions(p_limit int default 50)
returns setof public.storage_deletions
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select d.id from public.storage_deletions d
     where d.done_at is null and d.next_attempt_at <= now() and d.attempts < 8
     order by d.enqueued_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  )
  update public.storage_deletions d
     set attempts = d.attempts + 1,
         next_attempt_at = now() + (interval '1 minute' * power(2, least(d.attempts, 7)))
   where d.id in (select id from due)
  returning d.*;
end;
$$;
revoke execute on function public.claim_storage_deletions(int) from public, anon, authenticated;

create or replace function public.settle_storage_deletion(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.storage_deletions
     set done_at = case when p_ok then now() else done_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where id = p_id;
$$;
revoke execute on function public.settle_storage_deletion(uuid, boolean, text) from public, anon, authenticated;

-- Réservé au service : la réconciliation enfile les orphelins qu'elle a trouvés.
create or replace function public.enqueue_storage_deletion(p_path text, p_org uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.storage_deletions (bucket, storage_path, organization_id, reason)
  values ('request-attachments', p_path, p_org, p_reason)
  on conflict (bucket, storage_path) where done_at is null do nothing;
$$;
revoke execute on function public.enqueue_storage_deletion(text, uuid, text) from public, anon, authenticated;

-- Lignes d'attente dont l'objet doit partir : expirées sans rattachement, ou
-- retirées. L'edge retire l'objet PUIS appelle purge_attachment_upload.
create or replace function public.expired_attachment_uploads(p_limit int default 100)
returns setof public.attachment_uploads
language sql stable security definer set search_path = '' as $$
  select * from public.attachment_uploads u
   where u.consumed_at is null
     and (u.discarded_at is not null or u.expires_at < now())
   order by u.expires_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke execute on function public.expired_attachment_uploads(int) from public, anon, authenticated;

create or replace function public.purge_attachment_upload(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.attachment_uploads where id = p_id and consumed_at is null;
$$;
revoke execute on function public.purge_attachment_upload(uuid) from public, anon, authenticated;

-- Lignes consommées depuis plus de p_days : la ligne seule (l'objet est à la pièce).
create or replace function public.purge_consumed_uploads(p_days int default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.attachment_uploads
   where consumed_at is not null
     and consumed_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purge_consumed_uploads(int) from public, anon, authenticated;

-- Réconciliation : ce que la base connaît (chemins) et ce que le bucket contient.
create or replace function public.attachment_known_paths()
returns table (path text, source text)
language sql stable security definer set search_path = '' as $$
  select a.storage_path, 'attachment'::text from public.request_attachments a
  union
  select u.storage_path, 'upload'::text from public.attachment_uploads u;
$$;
revoke execute on function public.attachment_known_paths() from public, anon, authenticated;

create or replace function public.bucket_objects(p_bucket text)
returns table (name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.name, o.created_at from storage.objects o where o.bucket_id = p_bucket;
$$;
revoke execute on function public.bucket_objects(text) from public, anon, authenticated;

create or replace function public.mark_attachments_missing(p_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.request_attachments
     set copy_status = 'error'
   where storage_path = any(coalesce(p_paths, '{}'::text[]))
     and copy_status <> 'error';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.mark_attachments_missing(text[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Cron — toutes les 10 minutes. Même motif que notifications-mailer : le
--    secret est lu dans le Vault à l'exécution ; sans lui la fonction répond
--    401 et le job est inoffensif à vide.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('attachments-maintenance')
 where exists (select 1 from cron.job where jobname = 'attachments-maintenance');

select cron.schedule(
  'attachments-maintenance',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/attachments-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);
