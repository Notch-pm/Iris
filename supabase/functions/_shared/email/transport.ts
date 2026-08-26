// Envoi SMTP — seule brique de ce dossier à dépendre du runtime Deno.
// Tout ce qui décide (gabarit, textes, résolution de configuration) vit dans
// les modules purs voisins, testés par vitest.

import { Buffer } from "node:buffer";
import nodemailer from "npm:nodemailer@6";

import { senderHeader, useImplicitTls, type SmtpConfig } from "./config.ts";
import {
  renderEmailHtml,
  renderEmailText,
  type EmailBrand,
  type EmailContent,
} from "./template.ts";

/** Pièce jointe déjà chargée en mémoire — le téléchargement depuis le bucket
 *  privé est le métier de l'appelant, pas du transport. */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

/**
 * ⚠️ Contrairement à Clara, la vérification du certificat du relais N'EST PAS
 * désactivée : un `rejectUnauthorized: false` transforme le TLS en décoration.
 * Un relais à certificat auto-signé échouera donc franchement — le message
 * d'erreur remonte tel quel dans les journaux de la fonction appelante.
 */
export async function sendBrandedEmail(
  config: SmtpConfig,
  to: string,
  content: EmailContent,
  brand: EmailBrand,
  attachments: EmailAttachment[] = [],
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: useImplicitTls(config),
    requireTLS: config.useTls,
    auth: config.username ? { user: config.username, pass: config.password ?? "" } : undefined,
  });

  await transporter.sendMail({
    from: senderHeader(config),
    to,
    subject: content.subject,
    text: renderEmailText(content, brand),
    html: renderEmailHtml(content, brand),
    // Une liste vide est inoffensive pour nodemailer : les appelants qui n'en
    // passent pas gardent exactement le message d'avant.
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType || undefined,
    })),
  });
}
