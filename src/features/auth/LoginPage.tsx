import * as React from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { AuthCard } from "@/features/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { readSsoReturnError, ssoSignInCredentials } from "@/features/auth/sso";

// Une fiche de demande est propre à un tenant/utilisateur : si un premier
// utilisateur s'est fait rediriger vers /login depuis /demandes/:id (session
// expirée) puis se déconnecte, l'URL de retour ne doit JAMAIS être rejouée
// pour un second utilisateur qui se connecterait ensuite sur ce poste — on
// retombe alors sur le tableau de bord plutôt que sur une fiche qui n'est
// peut-être plus la sienne.
const REQUEST_DETAIL_RE = /^\/demandes\/[^/]+$/;

export function LoginPage() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState(false);
  // Erreur rapportée au retour de Keycloak (agent non provisionné, suspendu…),
  // lue une fois au montage, puis effacée de l'URL pour ne pas réapparaître.
  const [ssoError, setSsoError] = React.useState<string | null>(
    () => readSsoReturnError(window.location.search, window.location.hash)?.message ?? null,
  );

  React.useEffect(() => {
    if (ssoError) window.history.replaceState(null, "", window.location.pathname);
  }, [ssoError]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    const redirectTo = REQUEST_DETAIL_RE.test(from) ? "/" : from;
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSso() {
    setError(null);
    setSsoError(null);
    setRedirecting(true);
    const { error } = await supabase.auth.signInWithOAuth(ssoSignInCredentials(window.location.origin));
    // En cas de succès, le navigateur part vers Keycloak : on ne revient ici qu'en échec.
    if (error) {
      setRedirecting(false);
      setSsoError(readSsoReturnError(`?error=${encodeURIComponent(error.message)}`, "")!.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSsoError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError("Email ou mot de passe incorrect.");
    }
  }

  return (
    <AuthCard description="Connectez-vous pour accéder à votre espace.">
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="lg" disabled={redirecting} onClick={handleSso}>
          {redirecting ? "Redirection…" : "Se connecter avec le compte de ma collectivité"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Si votre collectivité a relié son annuaire (Microsoft…).
        </p>
        {ssoError ? (
          <p role="alert" className="text-sm text-destructive">
            {ssoError}
          </p>
        ) : null}
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou avec votre mot de passe
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Mot de passe" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Link
          to="/mot-de-passe-oublie"
          className="-mt-2 self-end text-sm text-primary hover:underline"
        >
          Mot de passe oublié ?
        </Link>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting} className="mt-2">
          {submitting ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
    </AuthCard>
  );
}
