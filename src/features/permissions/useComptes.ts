// Paramètres › Droits › Utilisateurs — ouverture et dépannage des comptes.
// Tout passe par l'edge function `admin-users` (service role), qui tranche
// l'habilitation en SQL (`is_org_admin_anywhere_for`, `can_manage_account`) :
// aucun mot de passe n'est généré ni affiché ici, un compte s'ouvre par un lien
// d'activation et se dépanne par un lien de réinitialisation.
//
// Le serveur d'envoi de ces messages n'est PAS réglé dans Iris : il vient du
// Socle (organisation principale), recopié par la synchronisation du
// référentiel — cf. docs/emails.md.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeAdminUsers } from "@/lib/adminUsers";

export interface InviteMemberResult {
  user_id: string;
  email: string;
  invited: boolean;
  email_sent: boolean;
  email_error?: string;
  message?: string;
}

export function useInviteMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      firstName: string;
      lastName: string;
    }): Promise<InviteMemberResult> =>
      invokeAdminUsers<InviteMemberResult>({
        action: "invite_user",
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        organization_id: orgId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["permission-members"] });
      void queryClient.invalidateQueries({ queryKey: ["permission-members-without-profile"] });
    },
  });
}

/** Renvoie au membre un lien pour choisir un nouveau mot de passe. */
export function useSendMemberPasswordReset() {
  return useMutation({
    mutationFn: async (userId: string): Promise<{ email: string }> =>
      invokeAdminUsers<{ email: string }>({ action: "send_password_reset", user_id: userId }),
  });
}
