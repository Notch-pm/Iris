-- ============================================================================
-- Sélecteur de mentions : la RPC rend aussi la photo.
--
-- Signature élargie → drop + recreate (CREATE OR REPLACE ne sait pas changer
-- un RETURNS TABLE).
--
-- ⚠️ La liste continue d'inclure l'APPELANT : elle sert AUSSI à résoudre les
-- noms et photos des mentions DÉJÀ écrites, les siennes comprises (l'affichage
-- ne fait jamais confiance au nom figé dans le jeton). Ne pas se proposer
-- soi-même est une décision d'INTERFACE — elle est prise à l'écran
-- (`withoutSelf`, testée), pas ici : amputer la RPC ferait retomber sa propre
-- mention sur le nom du jeton.
-- ============================================================================

drop function if exists public.mentionable_users(uuid);

create or replace function public.mentionable_users(p_request_id uuid)
returns table (user_id uuid, display_name text, email text, avatar_path text)
language plpgsql stable security definer set search_path = '' as $fn$
declare v_org uuid; v_dest uuid; v_proc uuid;
begin
  if not public.can_read_request(p_request_id) then
    raise exception 'Demande introuvable.';
  end if;
  select r.organization_id, r.socle_organization_id, r.socle_procedure_id
    into v_org, v_dest, v_proc
    from public.requests r where r.id = p_request_id;

  return query
    select m.user_id, public.user_display_name(u.id), u.email, u.avatar_path
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = v_org
       and public.request_right_for(m.user_id, v_org, v_dest, v_proc, 'consultation')
     order by 2;
end;
$fn$;
comment on function public.mentionable_users(uuid) is
  'Membres du tenant pouvant CONSULTER la demande (+ photo) : alimente le selecteur de mentions ET la resolution des noms vivants des mentions deja ecrites. Inclut l''appelant a dessein. Reflet — la garde t03_request_messages_guard_mentions reste l''autorite.';
revoke execute on function public.mentionable_users(uuid) from public, anon;
grant  execute on function public.mentionable_users(uuid) to authenticated;
