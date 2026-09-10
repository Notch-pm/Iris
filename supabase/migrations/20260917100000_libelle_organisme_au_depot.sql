-- ============================================================================
-- Libellé de l'organisme responsable posé AU DÉPÔT, relu dans le miroir
-- ============================================================================
--
-- Constat (DEM-2026-000050, 2026-09-17) : une demande ingérée depuis le
-- portail citoyen est bien rattachée à l'ACCM (`socle_organization_id` et
-- `socle_scope_org_id` posés), mais la fiche affiche « Aucun organisme
-- désigné », la liste « — », le tableau « Sans organisme ».
--
-- Cause : `socle_organization_label` est un CACHE d'affichage que seul le
-- transfert (`t08_requests_apply_transfer`, BEFORE UPDATE) relit dans le
-- miroir. Au dépôt, personne ne le pose pour l'ingestion partenaire :
-- `requests-api` n'envoie que l'identifiant — et son commentaire dit, à tort,
-- que « les libellés sont posés par triggers ». C'était vrai pour la démarche
-- (`t16` réécrit `socle_procedure_label`), jamais pour l'organisme. Le parcours
-- agent, lui, passe le libellé dans le payload de la RPC, d'où l'angle mort :
-- 45 demandes créées dans Iris avec libellé, 4 ingérées (portail, Clara) sans.
--
-- Règle posée : le libellé se RELIT dans le miroir au dépôt comme au
-- transfert — jamais soumis quand le miroir sait répondre. Même fonction
-- que le transfert pour ne pas maintenir deux fois la même règle ; nommée
-- `t08` à l'insert aussi, pour passer AVANT `t10` (garde), `t16`, `t18`, `t21`.
--
-- Miroir muet (organisation inconnue du tenant) : la valeur soumise reste,
-- comme au transfert — `t21` pose alors l'anomalie `destinataire_inconnu`, et
-- l'ingestion garde sa latitude. Sans identifiant, rien à relire.
--
-- ⚠️ Fonction DEFINER (elle lit le miroir hors RLS) : aucun
-- `is_service_context()` ici (piège du 2026-08-22, cf. CLAUDE.md).
-- ============================================================================

create or replace function public.requests_apply_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
begin
  -- Au dépôt, rien à comparer : l'organisme est « nouveau » par définition.
  -- À la mise à jour, seul un changement d'organisme nous concerne.
  -- (Deux `if` imbriqués : `old` n'existe pas à l'insert, et SQL ne promet
  -- aucun court-circuit du `and`.)
  if tg_op = 'UPDATE' then
    if new.socle_organization_id is not distinct from old.socle_organization_id then
      return new;
    end if;
  end if;

  -- Le libellé est un CACHE d'affichage : il se relit dans le miroir, il ne se
  -- soumet pas. Sans cela, un client pourrait transférer à la Voirie en
  -- écrivant « CCAS » dans le libellé, et toute la lecture humaine (liste,
  -- tableau, e-mails de notification) mentirait de concert. Le miroir muet
  -- (organisation inconnue) laisse la valeur soumise : t11 refuse déjà ce
  -- transfert-là côté client, et l'ingestion garde sa latitude.
  if new.socle_organization_id is not null then
    select m.name into v_label
      from public.socle_organizations m
     where m.organization_id = new.organization_id
       and m.socle_id = new.socle_organization_id
       and m.obsoleted_at is null;
    new.socle_organization_label := coalesce(v_label, new.socle_organization_label);
  end if;

  -- Au dépôt, l'affectation initiale est déjà gardée par `t10` (garde
  -- d'insertion) : la règle RM-16 ci-dessous ne vaut qu'au transfert.
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- RM-16 : l'affectataire doit détenir l'instruction sur le couple RETENU.
  -- Au transfert, on retire l'affectation plutôt que de refuser (PO 2026-09-01).
  if new.assigned_to is not null
     and not public.request_right_for(
           new.assigned_to, new.organization_id,
           new.socle_organization_id, new.socle_procedure_id, 'instruction') then
    new.assigned_to := null;
  end if;

  return new;
end;
$$;
comment on function public.requests_apply_transfer() is
  'Libellé de l''organisme relu dans le miroir (jamais soumis) au dépôt comme au transfert ; au transfert, affectation retirée si l''agent ne peut pas instruire le couple d''arrivée (RM-16). Interne, aucune EXECUTE cliente.';
-- Re-révoquer : le CREATE OR REPLACE re-grante PUBLIC (piège Clara).
revoke execute on function public.requests_apply_transfer() from public, anon, authenticated;

drop trigger if exists t08_requests_fill_organization_label on public.requests;
create trigger t08_requests_fill_organization_label
  before insert on public.requests
  for each row execute function public.requests_apply_transfer();

-- ----------------------------------------------------------------------------
-- Reprise — les demandes ingérées sans libellé, dont l'organisme est connu du
-- miroir. Colonne d'AFFICHAGE seulement : aucun identifiant ne bouge, donc ni
-- journal ni notification. Archivées exclues (gel `t10`), même motif que la
-- reprise du 2026-09-01.
-- ----------------------------------------------------------------------------
update public.requests r
   set socle_organization_label = m.name
  from public.socle_organizations m
 where m.organization_id = r.organization_id
   and m.socle_id = r.socle_organization_id
   and m.obsoleted_at is null
   and r.status <> 'archivee'
   and r.socle_organization_label is null;
