-- Le commentaire disait faux sur le mécanisme de purge : une demande n'est pas
-- supprimable par un simple DELETE, la cascade atteignant `request_events` que
-- `t01_request_events_immutable` protège. Constat établi par
-- supabase/tests/echanges-usager.test.sql (E9).
comment on table public.request_emails is
  'Échanges SORTANTS vers l''usager (courriel). Le corps est celui qui est RÉELLEMENT parti : aucune écriture cliente, la seule porte est l''edge function send-request-email. Aucune suppression non plus — un e-mail parti ne se dé-envoie pas (même raisonnement que « aucune suppression de demande ») ; la purge RGPD reste à écrire (procédure service_role dédiée) : elle devra lever l''immuabilité de request_events, seule chose qui empêche aujourd''hui de supprimer une demande — request_emails, lui, cascade déjà.';