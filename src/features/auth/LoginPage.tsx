import * as React from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError("Email ou mot de passe incorrect.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px] rounded-[14px] border border-border bg-card px-8 pb-7 pt-8 shadow-airbnb-lg">
        {/* Motif login Clara : pastille de marque + wordmark produit. */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="h-14 w-14 rounded-[14px]" aria-hidden="true" />
          <h1 className="mt-1 text-[32px] font-extrabold leading-none tracking-tight">Iris</h1>
          <p className="text-[13px] font-medium text-muted-foreground">
            Gestion des demandes d'usagers
          </p>
          <p className="text-[13px] text-muted-foreground">
            Connectez-vous pour accéder à votre espace.
          </p>
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
      </div>
    </div>
  );
}
