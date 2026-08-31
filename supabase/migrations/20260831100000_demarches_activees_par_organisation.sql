-- ============================================================================
-- Activation des démarches PAR ORGANISATION (Socle `organization_procedures`).
--
-- Le Socle porte, dans l'onglet « Démarches » de chaque organisation, un
-- interrupteur par démarche du catalogue de l'organisation principale :
-- « Activez les démarches proposées par ACCM pour cette organisation ».
-- Iris l'ignorait complètement — il proposait au guichet TOUTES les démarches
-- du tenant pour n'importe quel organisme, alors que le référentiel dit,
-- par exemple, que la mairie d'Arles n'en assure aucune.
--
-- ⚠️ **L'activation est un OPT-IN STRICT** : une démarche est active pour une
-- organisation SI ET SEULEMENT SI une liaison existe avec `is_enabled = true`.
-- L'absence de ligne vaut « non activée » — le défaut `true` de la colonne
-- Socle ne joue que sur une ligne déjà créée. Le miroir ci-dessous suit la
-- même règle : une ligne présente et non obsolète = activée, rien d'autre.
--
-- ⚠️ `procedures.is_active_global` du Socle est MORT fonctionnellement
-- (aucune lecture, exclu du DTO public) : ne jamais le miroiter ni s'y fier.
--
-- Trois notions voisines qui se CUMULENT, aucune ne remplace l'autre :
--   · `status`                       — le paramétrage est-il fini ? (brouillon
--                                      = ne rien servir, garde serveur t16)
--   · activation par organisation    — QUI la propose (cette migration)
--   · `communication_config`         — OÙ et QUAND (portail, période) : masque
--                                      seulement, jamais de garde.
--
-- Écriture : service_role uniquement (edge `sync-socle-referentiel`).
-- ============================================================================

create table if not exists public.socle_procedure_organizations (
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  socle_procedure_id uuid not null,       -- UUID Socle de la démarche (pas de FK : frontière de projet)
  socle_org_id       uuid not null,       -- UUID Socle de l'organisation qui la propose
  synced_at          timestamptz not null default now(),
  obsoleted_at       timestamptz,         -- désactivée / disparue : soft-delete, jamais de DELETE
  primary key (organization_id, socle_procedure_id, socle_org_id)
);
comment on table public.socle_procedure_organizations is
  'Miroir de Socle.organization_procedures (is_enabled = true) : quelles organisations du sous-arbre proposent quelle démarche. OPT-IN STRICT — une ligne absente ou obsolète vaut « non activée ». Rempli par sync-socle-referentiel via GET /v1/procedures?enabled_for=<org>, le DTO Socle n''exposant pas l''information en lecture directe.';

create index if not exists socle_procedure_organizations_org_idx
  on public.socle_procedure_organizations (organization_id, socle_org_id)
  where obsoleted_at is null;

alter table public.socle_procedure_organizations enable row level security;

-- Lecture : membre du tenant, comme les deux autres miroirs. Aucune écriture
-- cliente — la synchro est la seule porte.
drop policy if exists socle_procedure_organizations_select on public.socle_procedure_organizations;
create policy socle_procedure_organizations_select on public.socle_procedure_organizations
  for select to authenticated using (public.is_org_member(organization_id));
