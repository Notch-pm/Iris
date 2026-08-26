import * as React from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthCard } from "@/features/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

/**
 * Mot de passe oublié — self-service depuis l'écran de connexion.
 *
 * L'envoi passe par GoTrue (`resetPasswordForEmail`), que le hook
 * `auth-email-hook` habille du gabarit Iris et expédie par le serveur du
 * tenant. Le lien retombe sur /nouveau-mot-de-passe.
 *
 * ⚠️ La réponse est TOUJOURS la même, compte existant ou non : cet écran est
 * public, il ne doit pas devenir un annuaire d'adresses valides.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // L'erreur éventuelle est journalisée par Supabase, jamais montrée :
    // la distinguer d'un succès révélerait l'existence du compte.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    });
    setSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title="Vérifiez votre boîte mail">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Si un compte Iris est associé à <strong className="text-foreground">{email.trim()}</strong>,
            un message vient d'y être envoyé avec un lien pour choisir un nouveau mot de passe.
          </p>
          <p className="text-sm text-muted-foreground">
            Le message peut mettre quelques minutes à arriver — pensez à regarder dans les
            indésirables.
          </p>
          <Link to="/login" className="text-sm text-primary hover:underline">
            ← Retour à la connexion
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Mot de passe oublié"
      description="Indiquez votre adresse : nous vous enverrons un lien pour en choisir un nouveau."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="fp-email">
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" disabled={submitting} className="mt-2">
          {submitting ? "Envoi…" : "Envoyer le lien"}
        </Button>

        <Link to="/login" className="self-center text-sm text-primary hover:underline">
          ← Retour à la connexion
        </Link>
      </form>
    </AuthCard>
  );
}
