-- ============================================================================
-- Téléphones des UTILISATEURS (comptes agents) — fixe et portable.
--
-- ⚠️ Ne pas confondre avec les USAGERS : leurs téléphones existent déjà, mais
-- dans le SOCLE (`contacts.mobile_phone` / `landline_phone`, lus par
-- `socle-proxy`). Iris ne miroite aucun usager. Ici il s'agit des comptes
-- d'agents de `public.users`, qui n'avaient jusqu'ici que nom, prénom,
-- courriel et photo.
--
-- **Noms alignés sur le Socle** (`mobile_phone` / `landline_phone`) : les deux
-- notions se ressemblent assez pour qu'un nom différent de chaque côté finisse
-- par tromper quelqu'un.
--
-- **Aucune policy à toucher.** `users_update` autorise déjà l'utilisateur sur
-- SA ligne et l'administrateur de plateforme sur toutes : deux colonnes de plus
-- sont donc écrites par les bonnes personnes, sans rien ajouter.
--
-- **Aucune garde non plus**, et c'est un choix. `t03_users_protect_email`
-- existe parce que le courriel est l'IDENTIFIANT DE CONNEXION, miroir de
-- `auth.users` : le laisser diverger casserait la connexion en silence. Un
-- numéro de téléphone n'est l'identifiant de rien — c'est une coordonnée que
-- son titulaire tient à jour lui-même, exactement comme son prénom.
--
-- La seule contrainte est une borne de longueur : elle attrape un collage
-- accidentel sans rien dire du FORMAT — indicatifs étrangers, extensions et
-- séparations libres restent acceptés (même parti pris que pour les contacts
-- du Socle, où rien n'est normalisé non plus).
-- ============================================================================

alter table public.users
  add column if not exists landline_phone text,
  add column if not exists mobile_phone   text;

comment on column public.users.landline_phone is
  'Téléphone fixe de l''agent. Coordonnée personnelle, tenue par son titulaire (ou un administrateur de plateforme). Aucun format imposé.';
comment on column public.users.mobile_phone is
  'Téléphone portable de l''agent. Même régime que landline_phone. Nommé comme dans le Socle, où la même notion existe pour les usagers.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_phones_length_check') then
    alter table public.users add constraint users_phones_length_check
      check (char_length(coalesce(landline_phone, '')) <= 40
         and char_length(coalesce(mobile_phone, ''))   <= 40);
  end if;
end
$$;
