-- ============================================================================
-- Retrait du plafond IA d'Iris — défait 20260828170000, 170100 et 170200.
--
-- ⚠️ UNE MIGRATION, PAS UN ROLLBACK, et la distinction n'est pas cosmétique.
-- `supabase/rollback/` abrite des filets d'URGENCE : des scripts qui annulent
-- un lot qu'on regrette, et qu'on ne veut pas voir dans l'historique parce
-- qu'ils n'ont jamais dû exister. Ici, la suppression est le geste voulu : le
-- plafond d'Iris a vécu vingt-quatre heures et laisse la place au Socle. Un
-- lecteur futur doit voir la création PUIS le retrait — les cacher lui ferait
-- chercher pendant une heure pourquoi trois tables documentées sont absentes.
--
-- POURQUOI CE RETRAIT. Depuis le 2026-08-29, la clé du fournisseur LLM et la
-- comptabilité des jetons vivent dans le SOCLE (`ai-api`) : Iris compose le
-- prompt et le confie au guichet, qui réserve, appelle et solde. Le plafond est
-- désormais celui de la COLLECTIVITÉ, commun à toute la gamme — Iris n'en voit
-- qu'une part et ne peut donc plus en être le comptable.
--
-- ⚠️ CE QUI RESTERAIT SI ON LAISSAIT CES TABLES EN PLACE n'est pas « du code
-- mort », c'est un SECOND COMPTEUR. Un jour quelqu'un lirait `ai_usage_counters`
-- d'Iris, y verrait zéro, et en conclurait que la collectivité n'a rien
-- consommé — alors qu'elle aurait dépensé son mois. Un chiffre faux est pire
-- qu'un chiffre absent : on ne se méfie pas d'un tableau qui s'affiche.
--
-- ⚠️ GARDE-FOU : le script REFUSE de s'exécuter si `ai_usage_events` contient
-- la moindre ligne. Une consommation enregistrée est une pièce comptable ; si
-- Iris en a facturé une avant la bascule, elle doit être reprise dans le Socle
-- AVANT toute suppression, pas effacée au passage. Au 2026-08-29, la table est
-- vide (vérifié) : Iris n'a jamais appelé Mistral directement en production.
--
-- ⚠️ pg_cron RESTE INSTALLÉ. L'extension sert (ou servira) à d'autres jobs
-- d'Iris — notamment le facteur de la boîte d'envoi des notifications. Seul le
-- job `release-stale-ai-reservations` est déprogrammé.
--
-- Après exécution : régénérer `src/types/database.types.ts`
-- (`generate_typescript_types`), sans quoi le typage annonce trois tables et
-- cinq RPC qui n'existent plus.
-- ============================================================================

do $$
declare
  v_events bigint;
begin
  select count(*) into v_events from public.ai_usage_events;
  if v_events > 0 then
    raise exception
      'RETRAIT REFUSÉ : % ligne(s) dans ai_usage_events. Une consommation enregistrée est une pièce comptable — la reprendre dans le Socle avant de supprimer, jamais l''effacer au passage.',
      v_events;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Le job planifié (migration 20260828170200)
-- ---------------------------------------------------------------------------
select cron.unschedule('release-stale-ai-reservations')
 where exists (select 1 from cron.job where jobname = 'release-stale-ai-reservations');

-- ---------------------------------------------------------------------------
-- 2. Les RPC (migration 20260828170100)
--
-- Signatures explicites : un `drop function` sans arguments échoue dès qu'une
-- surcharge existe, et laisserait le script à moitié appliqué.
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_ai_usage(uuid, text, text, bigint, uuid, uuid, uuid);
drop function if exists public.settle_ai_usage(uuid, bigint, text);
drop function if exists public.release_stale_ai_reservations(integer);
drop function if exists public.set_ai_usage_quota(uuid, bigint, boolean, text);
drop function if exists public.delete_ai_usage_quota(uuid, text);

-- ---------------------------------------------------------------------------
-- 3. Les tables (migration 20260828170000)
--
-- `cascade` emporte policies, index et contraintes. L'ordre suit les
-- dépendances : le journal d'abord, le plafond en dernier.
-- ---------------------------------------------------------------------------
drop table if exists public.ai_usage_events cascade;
drop table if exists public.ai_usage_counters cascade;
drop table if exists public.ai_usage_quotas cascade;

-- ---------------------------------------------------------------------------
-- 4. Vérification — le script échoue s'il reste quoi que ce soit.
--
-- Un retrait à moitié appliqué est le pire des états : il laisse croire que
-- c'est fait. On le fait donc dire à voix haute.
-- ---------------------------------------------------------------------------
do $$
declare
  v_reste text;
begin
  select string_agg(nom, ', ') into v_reste from (
    select unnest(array['ai_usage_quotas', 'ai_usage_counters', 'ai_usage_events']) as nom
  ) t where to_regclass('public.' || nom) is not null;
  if v_reste is not null then
    raise exception 'Tables encore présentes : %', v_reste;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '%ai_usage%'
  ) then
    raise exception 'Des fonctions ai_usage subsistent.';
  end if;

  if exists (select 1 from cron.job where jobname = 'release-stale-ai-reservations') then
    raise exception 'Le job cron est encore programmé.';
  end if;

  raise notice 'Retrait du plafond IA : terminé. Régénérer database.types.ts.';
end $$;
