import * as React from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { AuthCard } from "@/features/auth/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  markSilentSso,
  readSilentSso,
  readSsoReturnError,
  silentSsoRetryAllowed,
  silentSsoStorage,
  ssoSignInCredentials,
  ssoSilentSignInCredentials,
} from "@/features/auth/sso";

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
  // Connexion unique (lot 4) : Keycloak est l'entrée de la gamme. Le mot de
  // passe d'Iris reste en secours (admin plateforme, panne de Keycloak),
  // derrière « Autre méthode de connexion ».
  const [showPassword, setShowPassword] = React.useState(false);
  // Erreur rapportée au retour de Keycloak (agent non provisionné, suspendu…),
  // lue une fois au montage, puis effacée de l'URL pour ne pas réapparaître.
  // Connexion silencieuse : un agent déjà connecté à Keycloak par une autre
  // application entre sans recliquer (voir sso.ts).
  const [storage] = React.useState(silentSsoStorage);
  const [silent] = React.useState(() =>
    readSilentSso(storage, window.location.search, window.location.hash),
  );
  const [silentPending, setSilentPending] = React.useState(silent.attempt);
  const [ssoError, setSsoError] = React.useState<string | null>(
    () =>
      readSsoReturnError(window.location.search, window.location.hash, {
        silent: silent.returning,
      })?.message ?? null,
  );

  // L'erreur d'un retour (« pas de session » comprise) s'efface de l'URL : sinon
  // un F5 la relirait et ne retenterait pas la connexion silencieuse.
  React.useEffect(() => {
    if (ssoError || (silent.returning && readSsoReturnError(window.location.search, window.location.hash))) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [ssoError, silent.returning]);

  React.useEffect(() => {
    if (silent.returning) markSilentSso(storage, "done");
  }, [silent.returning, storage]);

  const trySilentSso = React.useCallback(() => {
    markSilentSso(storage, "pending");
    setSilentPending(true);
    void supabase.auth
      .signInWithOAuth(ssoSilentSignInCredentials(window.location.origin))
      .then(({ error }) => {
        if (error) {
          markSilentSso(storage, "done");
          setSilentPending(false);
        }
      });
  }, [storage]);

  React.useEffect(() => {
    if (!silent.attempt || loading || session) return;
    trySilentSso();
  }, [silent.attempt, trySilentSso, loading, session]);

  // Retour sur un onglet resté sur la page de connexion : l'agent s'est peut-être
  // connecté entre-temps dans une autre application. Jamais formulaire de mot de
  // passe ouvert (on effacerait la saisie), jamais plus d'une fois par délai.
  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible" || showPassword) return;
      if (silentSsoRetryAllowed(storage)) trySilentSso();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [showPassword, storage, trySilentSso]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  if (!session && silentPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Connexion…
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
        <Button type="button" size="lg" disabled={redirecting} onClick={handleSso}>
          {redirecting ? "Redirection…" : "Se connecter avec le compte de ma collectivité"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Un seul compte pour toutes les applications de la gamme.
        </p>
        {ssoError ? (
          <p role="alert" className="text-sm text-destructive">
            {ssoError}
          </p>
        ) : null}
      </div>

      {!showPassword ? (
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-primary hover:underline"
        >
          Autre méthode de connexion
        </button>
      ) : (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            ou avec le mot de passe d'Iris
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

            <Button type="submit" variant="outline" size="lg" disabled={submitting} className="mt-2">
              {submitting ? "Connexion…" : "Se connecter"}
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}
