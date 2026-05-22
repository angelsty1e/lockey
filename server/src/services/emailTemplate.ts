/**
 * Templates HTML pour les e-mails transactionnels de Lockey.
 *
 * Les e-mails HTML doivent rester compatibles avec les MUA classiques
 * (Outlook, Gmail, Apple Mail, Thunderbird) qui ne supportent que partiellement
 * les standards modernes — d'où l'usage exclusif de tables imbriquées et de
 * styles inline. Pas de flexbox, pas de grid, pas de classes CSS.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailRow {
  label: string;
  value: string;
  /** Si true, la valeur est affichée en mono (host, serial, etc.) */
  mono?: boolean;
}

export interface EmailLayoutInput {
  /** Titre du bandeau coloré (ex: "Test SMTP réussi") */
  heading: string;
  /** Sous-titre du bandeau (ex: "Configuration opérationnelle") */
  subheading?: string;
  /** Couleur d'accentuation du bandeau ; défaut = cyan */
  accent?: 'cyan' | 'green' | 'amber' | 'red';
  /** Texte d'introduction (HTML, doit être pré-échappé) */
  introHtml: string;
  /** Lignes clé/valeur affichées dans une mini-table */
  rows?: EmailRow[];
  /** Bloc de notes en pied de carte (HTML, pré-échappé) */
  footnoteHtml?: string;
}

const ACCENTS = {
  cyan:  { bg: '#0ea5b7', text: '#ffffff' },
  green: { bg: '#16a34a', text: '#ffffff' },
  amber: { bg: '#d97706', text: '#ffffff' },
  red:   { bg: '#dc2626', text: '#ffffff' },
};

/**
 * Génère un e-mail HTML auto-suffisant prêt à passer dans `transporter.sendMail`.
 * Toutes les valeurs dynamiques injectées via `rows` et `EmailLayoutInput` sont
 * échappées HTML — n'incluez jamais de HTML brut dans `value`/`label`.
 * En revanche `introHtml` et `footnoteHtml` doivent être pré-échappés par
 * l'appelant (autorise le balisage `<strong>`, `<a>`, etc.).
 */
export function renderEmail(input: EmailLayoutInput): string {
  const accent = ACCENTS[input.accent ?? 'cyan'];
  const rowsHtml = (input.rows ?? [])
    .map(r => {
      const label = escapeHtml(r.label);
      const value = escapeHtml(r.value);
      const valueStyle = r.mono
        ? 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;'
        : 'font-size:14px;color:#0f172a;';
      return `
        <tr>
          <td style="padding:8px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;width:120px;vertical-align:top;">${label}</td>
          <td style="padding:8px 0;${valueStyle}vertical-align:top;word-break:break-all;">${value}</td>
        </tr>`;
    })
    .join('');

  const heading = escapeHtml(input.heading);
  const subheading = input.subheading ? escapeHtml(input.subheading) : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:${accent.bg};color:${accent.text};padding:24px 28px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;opacity:0.85;">Lockey</div>
              <div style="font-size:20px;font-weight:600;margin-top:4px;line-height:1.3;">${heading}</div>
              ${subheading ? `<div style="font-size:13px;margin-top:4px;opacity:0.9;">${subheading}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:14px;line-height:1.6;color:#334155;">
              ${input.introHtml}
              ${rowsHtml ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid #e2e8f0;">
                ${rowsHtml}
              </table>` : ''}
              ${input.footnoteHtml ? `
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.55;">
                ${input.footnoteHtml}
              </div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
              Message automatique envoyé par Lockey &middot; ne pas répondre
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
