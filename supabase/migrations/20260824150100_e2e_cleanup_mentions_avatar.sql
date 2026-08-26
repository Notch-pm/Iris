-- ============================================================================
-- Purge du décor de vérification VISUELLE des ronds de mention (2026-08-24) —
-- miroir de la migration de cleanup appliquée.
--
-- Le décor : une photo de test (damier) posée depuis « Mon compte » puis
-- retirée par le bouton de l'écran, une note interne mentionnant le second
-- compte du propriétaire du projet, et une coupure TEMPORAIRE du canal e-mail
-- de ce destinataire pour ne pas expédier un message sans objet.
-- ============================================================================

delete from public.notifications
 where request_id in (select id from public.requests where reference = 'DEM-2026-000005');

delete from public.request_messages
 where body like '%peux-tu confirmer le passage%';

delete from public.notification_preferences;

-- La photo de test elle-même : ligne ET objet de stockage.
-- storage.protect_delete() interdit un DELETE direct hors API Storage ; le GUC
-- transactionnel le lève (motif des tests d'étanchéité du projet).
do $cleanup$
declare v_path text;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  select avatar_path into v_path from public.users
   where id = '3bc951fd-1ea9-4d4f-a709-c9bd0ac7fad2';
  update public.users set avatar_path = null
   where id = '3bc951fd-1ea9-4d4f-a709-c9bd0ac7fad2';
  if v_path is not null then
    delete from storage.objects where bucket_id = 'avatars' and name = v_path;
  end if;
end
$cleanup$;
