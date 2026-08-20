import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-4xl font-semibold text-primary">404</p>
      <p className="text-sm text-muted-foreground">Cette page n'existe pas.</p>
      <Link to="/" className="text-sm text-primary hover:underline">
        ← Retour à l'accueil
      </Link>
    </div>
  );
}
