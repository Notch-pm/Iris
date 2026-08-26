-- ============================================================================
-- Tests de « Mon compte » — ce qu'un utilisateur peut changer sur lui-même, et
-- ce qui reste administré.
--
-- Deux frontières vérifiées ici :
--   · l'ADRESSE E-MAIL est l'identifiant de connexion : son titulaire ne la
--     réécrit pas (trigger `t03_users_protect_email`), le contexte de service
--     si — c'est ce qui permet à un administrateur de la corriger ;
--   · la PHOTO est un geste strictement personnel : on dépose et on supprime
--     dans SON dossier, on lit celui des collègues du même tenant, jamais
--     celui d'un autre tenant.
--
-- Le changement de mot de passe n'apparaît pas : il vit entièrement dans
-- GoTrue (revérification par reconnexion côté client), Iris ne stocke aucun
-- mot de passe et n'a donc rien à garder ici.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL
-- editor ; le MCP execute_sql est en lecture seule → apply_migration, l'échec
-- final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_a uuid := gen_random_uuid();
  s_b uuid := gen_random_uuid();
  org1 uuid; org2 uuid;
  u_moi      uuid := gen_random_uuid();
  u_collegue uuid := gen_random_uuid();  -- même tenant
  u_autre    uuid := gen_random_uuid();  -- autre tenant
  v_fail text[] := '{}';
  v_int int;
  v_text text;
begin
  -- storage.protect_delete() (trigger STATEMENT de la plateforme) interdit
  -- tout DELETE direct hors API Storage : on le lève pour la transaction, ce
  -- sont les POLICIES qu'on teste (0 ligne affectée sans droit).
  perform set_config('storage.allow_delete_query', 'true', true);

  insert into auth.users (id, email, created_at, updated_at) values
    (u_moi,      'moi@compte.test',      now(), now()),
    (u_collegue, 'collegue@compte.test', now(), now()),
    (u_autre,    'autre@compte.test',    now(), now());

  insert into public.organizations (socle_org_id, name) values (s_a, 'Tenant A') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_b, 'Tenant B') returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_moi, 'agent'), (org1, u_collegue, 'agent'), (org2, u_autre, 'agent');

  insert into storage.objects (bucket_id, name) values
    ('avatars', u_moi::text      || '/a.png'),
    ('avatars', u_collegue::text || '/b.png'),
    ('avatars', u_autre::text    || '/c.png');

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_moi, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- C1 — mes noms et le chemin de ma photo m'appartiennent ------------------
  update public.users set first_name = 'Camille', last_name = 'Martin',
         avatar_path = u_moi::text || '/a.png'
   where id = u_moi;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'C1: je ne peux pas modifier MON profil'::text; end if;

  -- C2 — l'adresse e-mail, non : elle est administrée -----------------------
  begin
    update public.users set email = 'nouvelle@compte.test' where id = u_moi;
    v_fail := v_fail || 'C2: l''adresse e-mail a pu être modifiée par son titulaire'::text;
  exception when others then null;   -- toute erreur vaut refus : c'est le but
  end;
  select email into v_text from public.users where id = u_moi;
  if v_text <> 'moi@compte.test' then
    v_fail := v_fail || format('C2b: adresse changée malgré tout (%s)', v_text); end if;

  -- C3 — le profil d'autrui reste hors d'atteinte ---------------------------
  update public.users set first_name = 'Pirate' where id = u_collegue;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'C3: j''ai modifié le profil d''AUTRUI'::text; end if;

  -- C4 / C5 — dépôt : mon dossier oui, celui d'autrui non -------------------
  insert into storage.objects (bucket_id, name) values ('avatars', u_moi::text || '/d.png');
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'C4: je ne peux pas déposer MA photo'::text; end if;

  begin
    insert into storage.objects (bucket_id, name) values ('avatars', u_collegue::text || '/pirate.png');
    v_fail := v_fail || 'C5: j''ai pu déposer une photo dans le dossier d''AUTRUI'::text;
  exception when others then null;
  end;

  -- C6 — lecture : la mienne, et celle d'un collègue du même tenant ---------
  select count(*) into v_int from storage.objects
   where bucket_id = 'avatars' and name = u_moi::text || '/a.png';
  if v_int <> 1 then v_fail := v_fail || 'C6a: je ne vois pas MA photo'::text; end if;
  select count(*) into v_int from storage.objects
   where bucket_id = 'avatars' and name = u_collegue::text || '/b.png';
  if v_int <> 1 then
    v_fail := v_fail || 'C6b: je ne vois pas la photo d''un collègue du même tenant'::text; end if;

  -- C7 — mais jamais celle d'un autre tenant --------------------------------
  select count(*) into v_int from storage.objects
   where bucket_id = 'avatars' and name = u_autre::text || '/c.png';
  if v_int <> 0 then v_fail := v_fail || 'C7: FUITE — photo d''un AUTRE tenant visible'::text; end if;

  -- C8 — suppression : la mienne oui, celle d'autrui non --------------------
  delete from storage.objects where bucket_id = 'avatars' and name = u_moi::text || '/d.png';
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'C8a: je ne peux pas supprimer MA photo'::text; end if;
  delete from storage.objects where bucket_id = 'avatars' and name = u_collegue::text || '/b.png';
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'C8b: j''ai supprimé la photo d''AUTRUI'::text; end if;

  execute 'reset role';

  -- C9 — le contexte de service, lui, peut corriger une adresse -------------
  -- (sans quoi la garde C2 empêcherait aussi l'administration légitime).
  update public.users set email = 'corrigee@compte.test' where id = u_moi;
  select email into v_text from public.users where id = u_moi;
  if v_text <> 'corrigee@compte.test' then
    v_fail := v_fail || 'C9: le contexte de service ne peut plus corriger une adresse'::text; end if;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (mon compte) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
