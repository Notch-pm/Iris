-- La FK des pièces d'un échange passe de RESTRICT à CASCADE.
--
-- RESTRICT ne protégeait rien : la trace d'un envoi est tenue par l'ABSENCE de
-- policy DELETE sur request_emails (aucun client ne peut supprimer une ligne),
-- pas par cette FK. En revanche elle gênait la cascade légitime — supprimer une
-- demande (purge RGPD) supprime ses pièces ET ses échanges, et l'ordre des
-- cascades n'est pas garanti : le RESTRICT pouvait faire échouer la purge.
--
-- Migration correctrice : 20260826120000 est déjà appliquée, son miroir porte
-- désormais la forme finale.

alter table public.request_attachments
  drop constraint if exists request_attachments_email_id_fkey;
alter table public.request_attachments
  add constraint request_attachments_email_id_fkey
  foreign key (email_id) references public.request_emails(id) on delete cascade;

-- Le commentaire de table disait faux sur le mécanisme de purge : une demande
-- n'est pas supprimable par un simple DELETE, la cascade atteignant
-- `request_events` que `t01_request_events_immutable` protège. Constat établi
-- par supabase/tests/echanges-usager.test.sql (E9).
comment on table public.request_emails is
  'Échanges SORTANTS vers l''usager (courriel). Le corps est celui qui est RÉELLEMENT parti : aucune écriture cliente, la seule porte est l''edge function send-request-email. Aucune suppression non plus — un e-mail parti ne se dé-envoie pas (même raisonnement que « aucune suppression de demande ») ; la purge RGPD reste à écrire (procédure service_role dédiée) : elle devra lever l''immuabilité de request_events, seule chose qui empêche aujourd''hui de supprimer une demande — request_emails, lui, cascade déjà.';
