# CI Sécurité — OWASP Top 10 : 2025

Cette CI GitHub Actions vérifie le code de Lockey à chaque `push`/`pull_request` sur
`main`, plus un balayage hebdomadaire (lundi 06:00 UTC) pour détecter la dérive
supply-chain. Elle est structurée sur le référentiel **OWASP Top 10 : 2025**.

## Workflows

| Fichier | Rôle |
|---|---|
| `.github/workflows/security-owasp-2025.yml` | Pipeline principal (tests, SAST, secrets, supply-chain, misconfig). |
| `.github/workflows/codeql.yml` | SAST natif GitHub (analyse de flux). *Public, ou privé + GHAS.* |
| `.github/dependabot.yml` | Mises à jour automatiques des deps & actions (A03). |

## Couverture A01 → A10

| OWASP 2025 | Couvert par |
|---|---|
| **A01** Broken Access Control | `test-suite` (tests auth/scoping) · `sast-semgrep` · CodeQL |
| **A02** Security Misconfiguration | `config-scan` (Trivy misconfig) · `sast-semgrep` (Helmet/CORS/CSP) |
| **A03** Software Supply Chain Failures | `supply-chain` (npm audit ≥ high, SBOM, dependency-review) · `dependabot.yml` |
| **A04** Cryptographic Failures | `test-suite` (vault/smtp crypto) · `secrets-scan` (Gitleaks) · `sast-semgrep` |
| **A05** Injection | `sast-semgrep` · CodeQL · `test-suite` (validation Zod) |
| **A06** Insecure Design | `test-suite` (MFA, rate-limit) · `sast-semgrep` |
| **A07** Authentication Failures | `test-suite` (auth/csrf/mfa) · `sast-semgrep` |
| **A08** Software/Data Integrity Failures | `secrets-scan` · `supply-chain` (lockfile + `npm ci`) · actions épinglées · CodeQL |
| **A09** Logging & Alerting Failures | `sast-semgrep` (règles logging) · `test-suite` |
| **A10** Mishandling of Exceptional Conditions | `test-suite` (`errors.test`) · `sast-semgrep` (catch silencieux) |

## Politique de gating

- **Bloque la CI (hard fail)** : build/typecheck, suite de tests OWASP (145 tests),
  secrets commités (Gitleaks), vulnérabilités dépendances **≥ HIGH** (`npm audit`),
  introduction d'une dépendance vulnérable sur PR (`dependency-review`).
- **Report-only (onglet *Security*, ne bloque pas)** : Semgrep & Trivy publient en
  SARIF. Un *finding* y est à trier, pas un blocage de `main`. En revanche un scanner
  qui **plante** (et non qui *trouve*) doit être corrigé.

> Aligné sur la pratique maison `ci-security` : les SAST/scanners tournent en
> report-only ; seuls les échecs déterministes (tests, secrets, CVE high) bloquent.

## Pré-requis & notes

- **Lockfiles** : `npm ci` exige `server/package-lock.json` et `client/package-lock.json`
  (les deux sont versionnés). Régénérer avec `npm install --package-lock-only` après un
  changement de `package.json`.
- **SARIF / onglet Security** : l'upload est `continue-on-error` — il fonctionne sur les
  dépôts publics et les dépôts privés avec GitHub Advanced Security, et reste silencieux
  sinon (les scanners gardent leur valeur via les logs de job).
- **CodeQL** : à supprimer si le dépôt est privé sans GHAS (voir l'en-tête du fichier).
- **Tests** : unitaires (crypto/auth/csrf/mfa/validation/erreurs), **aucune base Postgres
  requise** — seulement `prisma generate`.
