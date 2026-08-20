import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder — le flux complet (envoi d'email + page de réinitialisation)
 * sera branché avec la configuration email du projet Supabase Iris.
 */
export function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <CardTitle>Mot de passe oublié</CardTitle>
          <CardDescription>
            La réinitialisation de mot de passe sera disponible une fois l'envoi d'emails
            configuré. En attendant, contactez votre administrateur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/login" className="text-sm text-primary hover:underline">
            ← Retour à la connexion
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
