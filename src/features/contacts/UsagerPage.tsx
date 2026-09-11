// Fiche usager — reprend la représentation de la fiche contact de Clara : pile
// verticale de cartes pleine largeur (identité + coordonnées, adresse, puis
// les éléments liés en tableau), sans onglets ni rail. Ici les éléments liés
// sont les DEMANDES de l'usager.
//
// Deux sources, deux régimes :
// - l'usager vient du Socle (socle-proxy, whitelist serveur, relu à chaque
//   visite, jamais stocké ni mis en cache par Iris) — il n'est donc ni
//   modifiable ni archivable depuis Iris, contrairement à Clara ;
// - les demandes sont des données Iris, bornées par le RLS : la fiche ne
//   montre que celles du périmètre du lecteur, et c'est la règle.

import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Check, HeartHandshake, Landmark, Mail, Pencil, Plus, User } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoCell, SOON, Surface, SurfaceHead } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { EdgeError } from "@/lib/edge";
import { useTenant } from "@/features/tenant/TenantProvider";
import { canCreateProcedure } from "@/features/rights/rights";
import { useSocleProceduresCatalog } from "@/features/socle/useSocleCatalog";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { formatBytes, formatDateTime } from "@/features/requests/instruction/instruction";
import { inlineViewable } from "@/features/requests/instruction/documents";
import {
  createAttachmentUrl, useContactAttachments, useContactRequests,
  type RequestAttachment, type RequestListItem,
} from "@/features/requests/useRequests";
import { useSocleContact } from "./useContacts";
import { UsagerEditDialog } from "./UsagerEditDialog";
import { groupAttachmentsByRequest, usagerDocumentsSummary, type UsagerDocumentGroup } from "./documents";
import {
  addressRows, contactName, contactRows, contactStatusLabel, contactTypeLabel,
  identityRows, isDarkColor, isInactive, usagerStats, type FieldRow,
} from "./usager";
import type { SocleContact } from "./rapprochement";

const TYPE_ICONS: Record<string, typeof User> = {
  personne: User,
  entreprise: Building2,
  association: HeartHandshake,
  administration: Landmark,
};

const COLUMNS = ["Référence", "Objet", "Démarche", "Statut", "Déposée le"];

export function UsagerPage() {
  // Gabarit LARGE, comme l'annuaire, la liste des demandes et le tableau de
  // bord : la colonne centrée à 1240 px paraissait étroite sur un grand écran
  // (retour PO 2026-09-19).
  useWideLayout();
  const { contactId } = useParams<{ contactId: string }>();
  const { current, rights } = useTenant();
  const orgId = current?.organizationId ?? "";

  const contactQuery = useSocleContact(orgId, contactId ?? null);
  const requestsQuery = useContactRequests(orgId, contactId ?? null);
  const attachmentsQuery = useContactAttachments(orgId, contactId ?? null);
  const procCatalog = useSocleProceduresCatalog(orgId);
  const [docError, setDocError] = React.useState<string | null>(null);

  const [editOpen, setEditOpen] = React.useState(false);
  // Le texte est conservé pendant le fondu de sortie (visible=false).
  const [toast, setToast] = React.useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const toastTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const flash = React.useCallback((text: string) => {
    setToast({ text, visible: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3200);
  }, []);

  if (!current) return null;

  const contact = contactQuery.data ?? null;
  const requests = requestsQuery.data ?? [];
  const stats = usagerStats(requests);
  const documentGroups = groupAttachmentsByRequest(attachmentsQuery.data ?? [], requests);

  async function openDocument(a: RequestAttachment, download: boolean) {
    setDocError(null);
    const url = await createAttachmentUrl(a.storage_path, download ? a.file_name : undefined);
    if (!url) {
      setDocError("Le document n'a pas pu être ouvert — URL signée refusée.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }
  // « Nouvelle demande » : au moins une démarche du cache créable (reflet de
  // confort, RM-58) — le serveur revalide le couple à la création. L'usager
  // part imposé dans le parcours (`?usager=`), non modifiable.
  // « Modifier » : même droit — c'est exactement la garde que `socle-proxy`
  // applique déjà à toutes les routes /v1/contacts/* (droit de création dans
  // le tenant). L'autorité reste l'edge function, l'UI ne fait que refléter.
  const canCreate =
    contact !== null
    && (rights.is_platform_admin
      || (procCatalog.data ?? []).some((o) => canCreateProcedure(rights, o.value)));

  const summary = requestsQuery.isLoading
    ? "Chargement…"
    : [
        `${stats.total} demande${stats.total > 1 ? "s" : ""} visible${stats.total > 1 ? "s" : ""}`,
        `${stats.open} en cours`,
        stats.lastAt ? `dernier dépôt le ${formatDateTime(stats.lastAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/demandes">
            <ArrowLeft /> Retour aux demandes
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" {...SOON}>
            <Mail /> Contacter
          </Button>
          {canCreate ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil /> Modifier
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/demandes/nouvelle?usager=${contactId}`}>
                <Plus /> Nouvelle demande
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {contactQuery.isLoading ? (
        <Surface>
          <p className="py-6 text-center text-sm text-muted-foreground">Chargement de la fiche…</p>
        </Surface>
      ) : contact ? (
        <IdentiteCard contact={contact} />
      ) : (
        <Surface>
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-sm font-bold">
              {(contactQuery.error as EdgeError | null)?.code === "not_found"
                ? "Usager introuvable dans le référentiel Socle."
                : "Fiche usager indisponible."}
            </p>
            {/* Message du serveur affiché tel quel (proxy ou Socle). */}
            {contactQuery.error instanceof Error ? (
              <p className="text-sm text-muted-foreground">{contactQuery.error.message}</p>
            ) : null}
          </div>
        </Surface>
      )}

      <Surface>
        <SurfaceHead title="Demandes de cet usager" sub={summary} />
        {requestsQuery.isError ? (
          <p className="text-sm text-muted-foreground">Demandes indisponibles — réessayez dans un instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((c) => (
                    <th key={c} className="px-4 py-2 font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requestsQuery.isLoading ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td>
                  </tr>
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">
                      Aucune demande visible pour cet usager.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => <RequestRow key={r.id} request={r} />)
                )}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      <Surface>
        <SurfaceHead
          title="Documents de cet usager"
          sub={attachmentsQuery.isLoading ? "Chargement…" : usagerDocumentsSummary(documentGroups)}
        />
        {attachmentsQuery.isError ? (
          <p className="text-sm text-muted-foreground">Documents indisponibles — réessayez dans un instant.</p>
        ) : documentGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun document visible pour cet usager : les pièces suivent ses demandes, et
            seules celles de votre périmètre sont montrées.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {documentGroups.map((g) => (
              <DocumentGroup key={g.requestId} group={g} onOpen={openDocument} />
            ))}
          </div>
        )}
        {docError ? <p role="alert" className="text-sm text-destructive">{docError}</p> : null}
      </Surface>

      {contact && canCreate ? (
        <UsagerEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          organizationId={orgId}
          contact={contact}
          onSaved={flash}
        />
      ) : null}

      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-airbnb-xl transition-all duration-200",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <Check className="size-4 text-primary" aria-hidden="true" />
        <span className="text-[13px] font-semibold">{toast.visible ? toast.text : ""}</span>
      </div>
    </div>
  );
}

/** Carte d'identité : en-tête (icône de public, nom, badges) puis les grilles. */
function IdentiteCard({ contact }: { contact: SocleContact }) {
  const TypeIcon = TYPE_ICONS[contact.contact_type ?? ""] ?? User;
  const inactive = isInactive(contact.status);

  return (
    <Surface className="gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <TypeIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-bold leading-tight tracking-tight">{contactName(contact)}</h1>
        <Badge variant="secondary">{contactTypeLabel(contact.contact_type)}</Badge>
        {inactive ? <Badge variant="destructive">{contactStatusLabel(contact.status)}</Badge> : null}
        <Badge variant="outline" className="ml-auto">Référentiel Socle</Badge>
      </div>
      <Grid rows={[...identityRows(contact), ...contactRows(contact)]} />

      <div className="border-t border-border pt-4">
        <Grid rows={addressRows(contact)} extra={<QuartierCell contact={contact} />} />
      </div>

      <p className="truncate font-mono text-[10.5px] text-muted-foreground" title={contact.id}>
        Socle · {contact.id}
      </p>
    </Surface>
  );
}

/** Grille libellé/valeur — 2 colonnes, 4 au-delà de `md` (motif Clara). */
function Grid({ rows, extra }: { rows: FieldRow[]; extra?: React.ReactNode }) {
  if (rows.length === 0 && !extra) {
    return <p className="text-sm text-muted-foreground">Non renseigné dans le référentiel.</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-4">
      {rows.map((row) => (
        <InfoCell key={row.label} label={row.label} value={row.value} mono={row.mono} />
      ))}
      {extra}
    </dl>
  );
}

/** Quartier : pastille à la couleur libre du référentiel (texte adapté). */
function QuartierCell({ contact }: { contact: SocleContact }) {
  const quartier = contact.quartier;
  const color = quartier?.color ?? null;
  return (
    <InfoCell
      label="Quartier"
      value={
        quartier?.name ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
              color === null && "border border-border",
              color !== null && (isDarkColor(color) ? "text-primary-foreground" : "text-foreground"),
            )}
            style={color === null ? undefined : { backgroundColor: color }}
          >
            {quartier.name}
          </span>
        ) : (
          "—"
        )
      }
    />
  );
}

/** Les documents d'une demande de l'usager : la référence renvoie à la fiche. */
function DocumentGroup({ group, onOpen }: {
  group: UsagerDocumentGroup;
  onOpen: (a: RequestAttachment, download: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/demandes/${group.requestId}`} className="font-mono text-xs font-semibold text-primary hover:underline">
          {group.reference}
        </Link>
        {group.subject ? <span className="truncate font-semibold">{group.subject}</span> : null}
        {group.status ? <StatusBadge status={group.status} /> : null}
      </div>
      <ul className="flex flex-col divide-y divide-border/60 rounded-[10px] border border-border">
        {group.documents.map(({ attachment: a, nature, superseded }) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className={cn("min-w-[160px] flex-1 break-all font-semibold", superseded && "line-through text-muted-foreground")}>
              {a.file_name}
            </span>
            <Badge variant="secondary">{nature}</Badge>
            {superseded ? <Badge variant="outline">Remplacée</Badge> : null}
            <span className="text-xs text-muted-foreground">
              {a.file_size !== null ? `${formatBytes(a.file_size)} · ` : ""}{formatDateTime(a.created_at)}
            </span>
            <span className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                disabled={a.copy_status !== "copied" || !inlineViewable(a.mime_type)}
                onClick={() => onOpen(a, false)}>
                Voir
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                disabled={a.copy_status !== "copied"}
                onClick={() => onOpen(a, true)}>
                Télécharger
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestRow({ request: r }: { request: RequestListItem }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/50">
      <td className="px-4 py-3">
        <Link to={`/demandes/${r.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
          {r.reference}
        </Link>
      </td>
      <td className="max-w-[320px] truncate px-4 py-3">{r.subject}</td>
      <td className="px-4 py-3">{r.socle_procedure_label ?? "Demande historique"}</td>
      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
      <td className="px-4 py-3 text-muted-foreground">{formatDateTime(r.created_at)}</td>
    </tr>
  );
}
