import * as React from "react";

/**
 * Coquille commune aux écrans publics d'authentification (connexion, mot de
 * passe oublié, définition du mot de passe) — motif du login Clara : pastille
 * de marque, wordmark produit, puis le titre de l'écran.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px] rounded-[14px] border border-border bg-card px-8 pb-7 pt-8 shadow-airbnb-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="h-14 w-14 rounded-[14px]" aria-hidden="true" />
          <h1 className="mt-1 text-[32px] font-extrabold leading-none tracking-tight">Iris</h1>
          <p className="text-[13px] font-medium text-muted-foreground">
            Gestion des demandes d'usagers
          </p>
          {title ? <h2 className="mt-2 text-lg font-bold leading-tight">{title}</h2> : null}
          {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
