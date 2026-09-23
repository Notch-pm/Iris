-- ============================================================================
-- Scope `requests:read_tenant` — les demandes d'UN usager, toutes sources.
--
-- Une intégration ne lit que les demandes de sa source. C'est juste pour un
-- partenaire, pas pour une application de la gamme qui montre un usager en
-- entier : Clara (fiche contact, espace élu) doit voir aussi ce qui est arrivé
-- par le portail ou le guichet, sinon sa vue « tout ce que cet usager a adressé
-- à la collectivité » ment par omission.
--
-- Le scope ne lève le filtre de source QUE si l'appel nomme un usager
-- (`GET /v1/requests?socle_contact_id=`, voir requests-api/_shared/list-query.ts) :
-- jamais d'aspiration du tenant entier. La liste blanche du sérialiseur ne
-- change pas (ni notes internes, ni form_data). L'index
-- requests_org_contact_idx (organization_id, socle_contact_id) sert déjà la
-- requête.
-- ============================================================================

alter table public.integration_credentials
  drop constraint if exists integration_credentials_scopes_check;

alter table public.integration_credentials
  add constraint integration_credentials_scopes_check
  check (
    scopes <@ array['requests:write', 'requests:read', 'requests:read_tenant']::text[]
    and array_length(scopes, 1) >= 1
  );
