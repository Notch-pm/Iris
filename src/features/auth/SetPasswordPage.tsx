import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { AuthCard } from "@/features/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

/**
 * Définition du mot de passe — deux portes d'entrée, un seul écran :
 *   /activer-compte        (lien d'invitation)
 *   /nouveau-mot-de-passe  (lien de réinitialisation)
 *
 * Deux formes de liens sont acceptées, parce que les deux circulent :
 *   • `?token_hash=…&type=…` — les liens produits par Iris (edge function
 *     admin-users) et par le hook d'emails ; on échange le jeton contre une
 *     session avec `verifyOtp`.
 *   • `#access_token=…` — la forme historique de GoTrue, que supabase-js
 *     transforme tout seul en session au chargement de la page.
 *
 * Dans les deux cas la session obtenue ne sert qu'à poser le mot de passe :
 * on déconnecte ensuite, et la première vraie connexion se fait avec le
 * nouveau mot de passe.
 */

/** Longueur minimale exigée côté écran. Le serveur peut être plus strict. */
const MIN_LENGTH = 8;

const OTP_TYPES: readonly EmailOtpType[] = ["invite", "recovery", "signup", "magiclink", "email_change"];

function otpTypeFrom(raw: string | null, fallback: EmailOtpType): EmailOtpType {
  return OTP_TYPES.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : fallback;
}

export function SetPasswordPage({ mode }: { mode: "invite" | "recovery" }) {
  const [searchParams] = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const otpType = otpTypeFrom(searchParams.get("type"), mode);

  const [state, setState] = React.useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (tokenHash) {
      setState("ready");
      return;
    }
    // Pas de jeton dans l'URL : supabase-js a peut-être déjà ouvert une
    // session à partir du fragment (#access_token=…).
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState(data.session ? "ready" : "invalid");
    });
    return () => {
      cancelled = true;
    };
  }, [tokenHash]);

  const isInvite = mode === "invite";
  const title = isInvite ? "Activez votre compte" : "Nouveau mot de passe";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);

    if (tokenHash) {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (verifyError) {
        setSubmitting(false);
        setState("invalid");
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    await supabase.auth.signOut();
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setState("done");
  }

  if (state === "checking") {
    return (
      <AuthCard title={title}>
        <p className="text-center text-sm text-muted-foreground">Vérification du lien…</p>
      </AuthCard>
    );
  }

  if (state === "invalid") {
    return (
      <AuthCard title="Lien invalide ou expiré">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {isInvite
              ? "Ce lien d'activation n'est plus valable. Demandez un nouvel envoi à votre administrateur."
              : "Ce lien de réinitialisation n'est plus valable. Vous pouvez en demander un nouveau."}
          </p>
          {isInvite ? null : (
            <Link to="/mot-de-passe-oublie" className="text-sm text-primary hover:underline">
              Demander un nouveau lien
            </Link>
          )}
          <Link to="/login" className="text-sm text-primary hover:underline">
            ← Retour à la connexion
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (state === "done") {
    return (
      <AuthCard title="Mot de passe enregistré">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {isInvite
              ? "Votre compte est actif. Connectez-vous avec votre adresse et le mot de passe que vous venez de choisir."
              : "Votre mot de passe a été mis à jour. Connectez-vous avec ce nouveau mot de passe."}
          </p>
          <Button asChild size="lg">
            <Link to="/login">Se connecter</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={title}
      description={
        isInvite
          ? "Choisissez le mot de passe qui ouvrira votre espace Iris."
          : "Choisissez un nouveau mot de passe pour votre compte."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="Mot de passe"
          htmlFor="sp-password"
          hint={`${MIN_LENGTH} caractères minimum.`}
        >
          <Input
            id="sp-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirmation" htmlFor="sp-confirmation">
          <Input
            id="sp-confirmation"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting} className="mt-2">
          {submitting ? "Enregistrement…" : isInvite ? "Activer mon compte" : "Enregistrer"}
        </Button>
      </form>
    </AuthCard>
  );
}
