-- Dette O9 (audit purge / performance du 2026-09-23) : six policies réévaluaient
-- `auth.uid()` — et `is_platform_admin()` pour `users_*` — à CHAQUE ligne
-- (advisor `auth_rls_initplan`). Elles datent d'avant la convention
-- `(select auth.uid())` du 2026-08-22.
--
-- AUCUN changement de sémantique : ALTER POLICY ne touche que les expressions,
-- la commande et les rôles (`authenticated`) restent ceux de la base. Les
-- expressions sont reprises de `pg_policy` LIVE (relues le 2026-10-16), pas des
-- miroirs de 20260820100000 / 20260820100200 — un miroir peut être en retard.
--
-- ⚠️ `is_org_member(organization_id)`, `shares_org_with(id)` et
-- `has_admin_scope(…)` prennent un argument qui varie par ligne : les
-- envelopper dans `(select …)` n'aurait pas de sens, ils restent tels quels.

alter policy users_select on public.users
  using ((id = (select auth.uid())) or (select public.is_platform_admin()) or public.shares_org_with(id));

alter policy users_update on public.users
  using ((id = (select auth.uid())) or (select public.is_platform_admin()))
  with check ((id = (select auth.uid())) or (select public.is_platform_admin()));

alter policy organization_members_select on public.organization_members
  using ((user_id = (select auth.uid())) or public.is_org_member(organization_id));

alter policy request_messages_insert on public.request_messages
  with check (
    (author_id = (select auth.uid()))
    and (
      (select public.is_platform_admin())
      or exists (
        select 1 from public.requests r
        where r.id = request_messages.request_id
          and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
              in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                    from public.my_permission_pairs('ecriture'::text) s(organization_id, socle_org_id, socle_procedure_id))
      )
    )
  );

alter policy request_messages_update on public.request_messages
  using (
    (select public.is_platform_admin())
    or (
      (author_id = (select auth.uid()))
      and exists (
        select 1 from public.requests r
        where r.id = request_messages.request_id
          and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
              in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                    from public.my_permission_pairs('ecriture'::text) s(organization_id, socle_org_id, socle_procedure_id))
      )
    )
    or exists (
      select 1 from public.requests r
      where r.id = request_messages.request_id
        and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  )
  with check (
    (select public.is_platform_admin())
    or (
      (author_id = (select auth.uid()))
      and exists (
        select 1 from public.requests r
        where r.id = request_messages.request_id
          and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
              in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                    from public.my_permission_pairs('ecriture'::text) s(organization_id, socle_org_id, socle_procedure_id))
      )
    )
    or exists (
      select 1 from public.requests r
      where r.id = request_messages.request_id
        and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );

alter policy request_messages_delete on public.request_messages
  using (
    (select public.is_platform_admin())
    or (
      (author_id = (select auth.uid()))
      and exists (
        select 1 from public.requests r
        where r.id = request_messages.request_id
          and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
              in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                    from public.my_permission_pairs('ecriture'::text) s(organization_id, socle_org_id, socle_procedure_id))
      )
    )
    or exists (
      select 1 from public.requests r
      where r.id = request_messages.request_id
        and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );
