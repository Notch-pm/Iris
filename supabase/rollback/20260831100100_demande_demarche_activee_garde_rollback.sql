-- Rollback de la garde « démarche activée pour cet organisme » (t18).
-- À jouer si le miroir des activations s'avère faux ou incomplet et bloque le
-- guichet : l'écran continuera de masquer, plus rien ne refusera.
-- ⚠️ Jamais via `apply_migration` (ce n'est pas une migration).
drop trigger if exists t18_requests_require_procedure_active on public.requests;
drop function if exists public.requests_require_procedure_active();
