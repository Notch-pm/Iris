-- B12, lot L4c-0 (docs/notifications-usager-architecture.md, ADR-11) :
-- `request_emails` distingue la NATURE d'un envoi et son MODE DE REMISE.
--
--   · nature   : `message` (un agent écrit à l'usager, l'accusé, l'avis de
--                clôture) ou `avis` (avis automatique de statut ou de nouveau
--                message, lot L4c-1). Un avis n'est PAS un message de l'espace
--                usager : `citizenView` l'exclut, et aucun indicateur « répondu
--                sous N jours » ne le compte.
--   · delivery : `courriel` (le texte est parti par e-mail) ou `espace` (le
--                message est publié dans l'espace usager, un avis avec extrait
--                part à sa place — M2, lot L4c-3).
--
-- Additif, sans effet visible : toutes les lignes existantes valent
-- `message` / `courriel`, ce qu'elles sont. Aucune policy ne change (service seul).
-- ⚠️ Prérequis de déploiement : la vue usager filtrant les avis doit être en
-- ligne AVANT le premier avis enregistré.

alter table public.request_emails
  add column if not exists nature text not null default 'message',
  add column if not exists delivery text not null default 'courriel';

alter table public.request_emails
  drop constraint if exists request_emails_nature_check,
  add constraint request_emails_nature_check check (nature in ('message', 'avis')),
  drop constraint if exists request_emails_delivery_check,
  add constraint request_emails_delivery_check check (delivery in ('courriel', 'espace'));

comment on column public.request_emails.nature is
  'message : écrit à l''usager (agent, accusé, clôture) ; avis : avis automatique (B12), jamais montré dans l''espace usager ni compté comme une réponse.';
comment on column public.request_emails.delivery is
  'courriel : le texte est parti par e-mail ; espace : publié dans l''espace usager, un avis avec extrait est parti à sa place (M2).';
