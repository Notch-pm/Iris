// Paramètres › Droits › Utilisateurs — dépannage des comptes (l'accès s'ouvre
// désormais dans le Socle, annuaire des agents du 2026-10-30).
// Tout passe par l'edge function `admin-users` (service role), qui tranche
// l'habilitation en SQL (`is_org_admin_anywhere_for`, `can_manage_account`) :
// aucun mot de passe n'est généré ni affiché ici, un compte s'ouvre par un lien
// d'activation et se dépanne par un lien de réinitialisation.
//
// Le serveur d'envoi de ces messages n'est PAS réglé dans Iris : il vient du
// Socle (organisation principale), recopié par la synchronisation du
// référentiel — cf. docs/emails.md.

import { useMutation } from "@tanstack/react-query";
import { invokeAdminUsers } from "@/lib/adminUsers";

/** Renvoie au membre un lien pour choisir un nouveau mot de passe. */
export function useSendMemberPasswordReset() {
  return useMutation({
    mutationFn: async (userId: string): Promise<{ email: string }> =>
      invokeAdminUsers<{ email: string }>({ action: "send_password_reset", user_id: userId }),
  });
}
