-- ============================================================================
-- Notifications — ordre d'affichage : clock_timestamp() au lieu de now().
--
-- Constat du test transactionnel (supabase/tests/notifications.test.sql, T6c) :
-- `now()` renvoie l'heure de DÉBUT DE TRANSACTION. Deux notifications nées du
-- MÊME geste — une réaffectation produit « retirée » pour l'ancien porteur et
-- « affectée » pour le nouveau — portaient donc un `created_at` IDENTIQUE, et
-- le `order by created_at desc` du volet devenait indéterminé (l'événement le
-- plus ancien pouvait s'afficher en tête).
--
-- `clock_timestamp()` lit l'horloge AU MOMENT DE L'INSERTION : l'ordre affiché
-- est toujours l'ordre réel, y compris à l'intérieur d'une transaction.
-- ============================================================================

alter table public.notifications alter column created_at set default clock_timestamp();
