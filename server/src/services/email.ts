import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailConfig } from '@prisma/client';
import { prisma } from '../db.js';
import { decryptSmtpPass } from '../utils/smtpCrypto.js';
import { logger } from '../logger.js';
import { renderEmail } from './emailTemplate.js';

export const SINGLETON_ID = 'default';

export async function getEmailConfig(): Promise<EmailConfig> {
  const existing = await prisma.emailConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.emailConfig.create({ data: { id: SINGLETON_ID } });
}

interface BuiltTransport {
  transporter: Transporter;
  fromAddress: string;
  config: EmailConfig;
}

function isConfigComplete(c: EmailConfig): boolean {
  return !!(c.smtpHost && c.smtpUser && c.smtpPass && c.fromEmail);
}

export async function buildTransport(): Promise<BuiltTransport> {
  const config = await getEmailConfig();
  if (!isConfigComplete(config)) {
    throw new Error('Configuration SMTP incomplète (host, user, pass, fromEmail requis).');
  }
  const port = config.smtpPort || 587;
  const transporter = nodemailer.createTransport({
    host: config.smtpHost!,
    port,
    secure: config.smtpSecure ?? port === 465,
    auth: {
      user: config.smtpUser!,
      pass: decryptSmtpPass(config.smtpPass!),
    },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  const fromAddress = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail!;
  return { transporter, fromAddress, config };
}

export interface SendMailInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<{ messageId: string }> {
  const { transporter, fromAddress } = await buildTransport();
  const info = await transporter.sendMail({
    from: fromAddress,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  logger.info({ to: input.to, subject: input.subject, messageId: info.messageId }, 'email sent');
  return { messageId: info.messageId };
}

export async function verifyAndSendTest(testTo: string): Promise<{ messageId: string }> {
  const { transporter, fromAddress, config } = await buildTransport();
  await transporter.verify();
  const securityLabel = config.smtpSecure ? 'SSL/TLS direct' : 'STARTTLS';
  const html = renderEmail({
    heading: 'Test SMTP réussi',
    subheading: 'La configuration e-mail est opérationnelle',
    accent: 'green',
    introHtml:
      `<p style="margin:0 0 12px;">Bonjour,</p>` +
      `<p style="margin:0;">Cet e-mail confirme que <strong>Lockey</strong> est correctement configuré ` +
      `pour envoyer des notifications via votre serveur SMTP. Vous pouvez maintenant activer les ` +
      `alertes d'expiration et les notifications transactionnelles.</p>`,
    rows: [
      { label: 'Hôte',       value: `${config.smtpHost}:${config.smtpPort}`, mono: true },
      { label: 'Sécurité',   value: securityLabel },
      { label: 'Compte',     value: config.smtpUser ?? '—', mono: true },
      { label: 'Expéditeur', value: fromAddress, mono: true },
      { label: 'Destinataire', value: testTo, mono: true },
    ],
    footnoteHtml:
      `Si vous n'êtes pas à l'origine de ce test, vérifiez les accès administrateur ` +
      `de votre instance Lockey.`,
  });
  const info = await transporter.sendMail({
    from: fromAddress,
    to: testTo,
    subject: 'Lockey — test SMTP réussi',
    text:
      `Test SMTP réussi\n` +
      `================\n\n` +
      `Bonjour,\n\n` +
      `Cet e-mail confirme que Lockey est correctement configuré pour envoyer des notifications ` +
      `via votre serveur SMTP.\n\n` +
      `  Hôte         : ${config.smtpHost}:${config.smtpPort}\n` +
      `  Sécurité     : ${securityLabel}\n` +
      `  Compte       : ${config.smtpUser}\n` +
      `  Expéditeur   : ${fromAddress}\n` +
      `  Destinataire : ${testTo}\n\n` +
      `Si vous n'êtes pas à l'origine de ce test, vérifiez les accès administrateur de votre instance.\n\n` +
      `— Lockey (message automatique)`,
    html,
  });
  return { messageId: info.messageId };
}
