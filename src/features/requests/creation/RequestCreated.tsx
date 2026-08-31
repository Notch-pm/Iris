// Confirmation de création + récépissé imprimable (zone .print-receipt, seule
// imprimée — voir index.css). Le récépissé ne contient que ce que l'usager peut
// connaître de sa propre demande : jamais de note interne.

import { Link } from "react-router-dom";
import { Check, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../StatusBadge";

interface Props {
  requestId: string;
  reference: string;
  procedureName: string;
  requesterLabel: string;
  linkedReferences: string[];
  linkError: string | null;
  onPrint: () => void;
  onRestart: () => void;
}

export function RequestCreated({
  requestId, reference, procedureName, requesterLabel, linkedReferences, linkError, onPrint, onRestart,
}: Props) {
  return (
    <div className="mx-auto mt-10 flex max-w-[660px] flex-col items-center gap-[18px] text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-success/15 text-primary" aria-hidden="true">
        <Check className="size-[30px]" strokeWidth={2.4} />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="text-[26px] font-bold tracking-tight">Demande créée</h2>
        <p className="text-sm text-muted-foreground">{procedureName} · {requesterLabel}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-xl font-bold tracking-wider">{reference}</span>
        <StatusBadge status="a_traiter" />
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-2.5">
        <Button asChild>
          <Link to={`/demandes/${requestId}`}>Ouvrir la demande</Link>
        </Button>
        <Button type="button" variant="outline" onClick={onPrint}>
          <Printer />
          Imprimer le récépissé
        </Button>
        <Button type="button" variant="ghost" onClick={onRestart}>
          Consigner une autre demande
        </Button>
      </div>
      {linkedReferences.length > 0 ? (
        <small className="text-xs text-muted-foreground">
          Liée à {linkedReferences.join(", ")} — visible depuis chaque fiche.
        </small>
      ) : null}
      {linkError ? (
        <small role="alert" className="text-xs text-destructive">
          La demande est créée mais la liaison n'a pas pu être enregistrée : {linkError}
        </small>
      ) : null}
    </div>
  );
}

export interface ReceiptData {
  tenantName: string;
  reference: string;
  createdAt: Date;
  procedureName: string;
  categoryLabel: string | null;
  destinationLabel: string | null;
  requesterRows: { label: string; value: string }[];
  subject: string;
  answers: { label: string; value: string }[];
  attachments: { label: string; name: string }[];
  agentName: string;
  linkedReferences: string[];
}

/** Rendu imprimable uniquement (display:none à l'écran). */
export function PrintReceipt({ data }: { data: ReceiptData }) {
  const when = data.createdAt.toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <section className="print-receipt font-sans text-[12pt] leading-relaxed" aria-hidden="true">
      <header className="mb-6 border-b border-black pb-3">
        <p className="text-[10pt] uppercase tracking-widest">{data.tenantName}</p>
        <h1 className="mt-1 text-[20pt] font-bold">Récépissé de dépôt de demande</h1>
        <p className="mt-1 text-[11pt]">
          Référence <strong className="font-mono">{data.reference}</strong> — enregistrée le {when}
        </p>
      </header>

      <h2 className="mb-1 text-[13pt] font-bold">Démarche</h2>
      <p>{data.procedureName}{data.categoryLabel ? ` (${data.categoryLabel})` : ""}</p>
      {data.destinationLabel ? <p>Organisme : {data.destinationLabel}</p> : null}
      <p>Objet : {data.subject}</p>

      <h2 className="mb-1 mt-5 text-[13pt] font-bold">Demandeur</h2>
      <dl>
        {data.requesterRows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <dt className="w-48 shrink-0">{r.label}</dt>
            <dd className="font-semibold">{r.value}</dd>
          </div>
        ))}
      </dl>

      {data.answers.length > 0 ? (
        <>
          <h2 className="mb-1 mt-5 text-[13pt] font-bold">Informations déclarées</h2>
          <dl>
            {data.answers.map((a, i) => (
              <div key={i} className="flex gap-2">
                <dt className="w-48 shrink-0">{a.label}</dt>
                <dd className="font-semibold">{a.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {data.attachments.length > 0 ? (
        <>
          <h2 className="mb-1 mt-5 text-[13pt] font-bold">Pièces remises</h2>
          <ul className="list-disc pl-5">
            {data.attachments.map((a, i) => (
              <li key={i}>{a.label} — {a.name}</li>
            ))}
          </ul>
        </>
      ) : null}

      {data.linkedReferences.length > 0 ? (
        <p className="mt-5">Demande(s) associée(s) : {data.linkedReferences.join(", ")}</p>
      ) : null}

      <footer className="mt-8 border-t border-black pt-3 text-[10pt]">
        <p>Demande consignée au guichet par {data.agentName}. Statut à la création : à traiter.</p>
        <p>Ce récépissé atteste du dépôt de la demande ; il ne préjuge pas de la suite qui lui sera donnée.</p>
      </footer>
    </section>
  );
}
