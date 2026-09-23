-- ============================================================================
-- Clara reçoit `requests:read_tenant` (contrat 2.4.0).
--
-- Toutes les clés NON révoquées de la source `clara`, quel que soit le tenant
-- (ACCM, Rosny, SNA au 2026-09-23) : la fiche contact et l'espace élu de Clara
-- montrent les demandes d'un usager toutes origines confondues. Le scope ne
-- vaut qu'avec un usager nommé (voir 20260923170000_scope_lecture_par_usager).
-- Idempotent : une clé qui le porte déjà n'est pas touchée. Une clé Clara
-- émise plus tard devra le recevoir à son émission.
-- ============================================================================

update public.integration_credentials c
set scopes = array_append(c.scopes, 'requests:read_tenant')
from public.integration_sources s
where s.id = c.integration_source_id
  and s.code = 'clara'
  and c.revoked_at is null
  and not ('requests:read_tenant' = any(c.scopes));
