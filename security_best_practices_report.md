# Security Best-Practices Review

Review date: 2026-09-14

Scope: React/Vite client, Hono Worker API, Cloudflare Access, D1, R2, Browser Run document generation, backup Workflow, GitHub Actions, and OpenTofu configuration. This is a source/configuration and deployed-control review, not a third-party penetration test.

## Executive summary

The application has a solid security foundation: Cloudflare Access is default-deny and restricted to four exact Google accounts; the Worker independently verifies Access JWT signature, issuer, audience, algorithm, token type, and email; production `workers.dev` and preview URLs are disabled; internal identifiers are UUIDs; D1 writes use bound parameters and Zod validation; generated documents escape dynamic HTML/XML; R2 artifacts and backups have no enabled public domain; and production logging avoids request bodies and document contents.

No critical vulnerability was identified. Two high-priority authorization/CI findings should be addressed before treating the deployment as fully hardened. Eight medium/low findings are defense-in-depth and operational improvements. Production R2 privacy was verified through the Cloudflare API, the latest backup verification Workflow completed successfully, the protected `main` ruleset is active, and `npm audit` reported no high or critical production dependency advisory.

## Critical findings

None identified.

## High findings

### SEC-001 — CI smoke identity can access the entire application

- Rule ID: AUTHZ-SERVICE-001
- Severity: High
- Location: `src/api/auth.ts`, `identityFromPayload`, lines 15-17; `src/worker.ts`, authentication middleware and API mount, lines 9-18
- Evidence: a correctly signed Access JWT matching `SMOKE_ACCESS_CLIENT_ID` is converted to `service:<client-id>`, then the same middleware permits it to continue to every `/api/v1` route. The deployed reusable `non_identity` Access policy is attached to the whole production and staging application, not only `/api/v1/health`.
- Impact: disclosure of the smoke client secret would allow non-human access to customer data, full exports, estimate artifacts, and all mutation endpoints—not merely the intended health check.
- Fix: after JWT verification, permit a service identity only for `GET /api/v1/health`; reject it for every other route. Add tests for service-token denial on reads, exports, and mutations.
- Mitigation: rotate the service token after the restriction ships and keep its secret only in the production GitHub environment.
- False-positive notes: Cloudflare still validates the client ID and secret before issuing the signed JWT. The finding is excessive post-authentication authorization, not authentication bypass.

### SEC-002 — Production-capable Cloudflare credentials are exposed to pull-request CI

- Rule ID: CI-SECRET-SCOPE-001
- Severity: High
- Location: `.github/workflows/ci.yml`, lines 1-3 and 18-19; `.github/workflows/deploy.yml`, lines 8 and 14-23
- Evidence: the pull-request workflow injects the repository-level `CLOUDFLARE_API_TOKEN` to query the production D1 database. Live GitHub inspection confirmed the deploy token and both Access smoke credentials are repository secrets; the `production` environment currently contains no secrets.
- Impact: a compromised maintainer account or malicious same-repository branch can modify the PR workflow and attempt to exfiltrate a token capable of production deployment/database operations before merge. GitHub does not expose these secrets to untrusted fork PRs, which narrows but does not remove the risk.
- Fix: remove remote production access from PR CI or use a separate read-only validation token; move deployment and smoke secrets into the protected `production` environment; limit that environment to `main`; and keep the deploy token at minimum Cloudflare scope.
- Mitigation: review workflow changes carefully and rotate the Cloudflare and smoke tokens after moving them.
- False-positive notes: the exact Cloudflare token permissions were not returned by the available read-only inspection, so the maximum blast radius should be verified in Cloudflare. The deployment workflow proves it has at least Worker/D1 deployment capability.

## Medium findings

### SEC-003 — The SPA shell lacks application security headers and publishes source maps

- Rule ID: REACT-HEADERS-001 / REACT-CONFIG-001
- Severity: Medium
- Location: `wrangler.jsonc`, static-assets routing, line 10; `src/worker.ts`, security-header middleware, line 8; `vite.config.ts`, line 8
- Evidence: an authenticated production request to `/` returned none of CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy`, while `/api/v1/health` returned the Hono headers. Static assets bypass the Worker because `run_worker_first` only covers `/api/*`. Production builds also upload `.js.map` files.
- Impact: the HTML/JS application shell lacks browser defense-in-depth against script injection, framing, MIME confusion, and referrer leakage. Public source maps reveal readable client code and internal structure, although Access still gates the files.
- Fix: add a Workers Static Assets `_headers` file for the SPA shell and assets, and disable production source-map publication (or upload maps only to a private error service).
- Mitigation: Cloudflare Access remains in front of the shell, React escapes text by default, and no dangerous HTML injection sink was found.
- False-positive notes: the result was verified at runtime, so this is not merely an absent repository configuration.

### SEC-004 — Cloudflare Access does not enforce MFA

- Rule ID: ACCESS-MFA-001
- Severity: Medium
- Location: `infra/main.tf`, company Access policy, lines 81-89; deployed Access policy inspected 2026-09-14
- Evidence: the allow policy includes four exact emails but has no `require` rule. Production uses a 12-hour session, HttpOnly cookies, and no explicit MFA requirement.
- Impact: compromise of an allowlisted Google password could grant access to all customer and estimate data if that Google account does not independently enforce strong MFA.
- Fix: add an Access `Require` rule for the `mfa` authentication method after confirming every allowlisted Google account emits the expected MFA claim; test all four accounts before enforcing.
- Mitigation: require Google two-step verification on every account now and shorten the Access session if operationally acceptable.
- False-positive notes: users may already have Google MFA enabled, but Cloudflare is not currently enforcing or attesting it.

### SEC-005 — Local OpenTofu state stores a service-token secret with broad file readability

- Rule ID: SECRET-STATE-001
- Severity: Medium
- Location: `docs/operations.md`, line 15; local `infra/terraform.tfstate` permissions inspected 2026-09-14
- Evidence: operations documentation identifies the local state as authoritative. The state contains the Access service token secret and is mode `0644`, allowing other local users to read it. It is correctly excluded from Git.
- Impact: another local account, malware, an unencrypted-device loss, or an overly broad backup could recover the service credential.
- Fix: move state to an encrypted remote backend with access controls and locking; immediately change the local state to owner-only permissions; rotate the service token after migration.
- Mitigation: full-disk encryption and single-user host controls reduce exposure.
- False-positive notes: no state file is tracked by Git, and no actual secret was printed during this review.

### SEC-006 — CSV exports do not neutralize spreadsheet formulas

- Rule ID: EXPORT-FORMULA-001
- Severity: Medium
- Location: `src/documents/csv.ts`, `csvCell`, lines 3-5; `src/documents/backup.ts`, lines 8-11
- Evidence: RFC 4180 quoting is applied, but cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return are emitted unchanged. Customer, job, catalog, line-item, and notes data can reach CSV exports.
- Impact: opening a crafted CSV in spreadsheet software can evaluate a formula, potentially triggering external requests or misleading the operator. Exploitation requires malicious stored content and a user opening the CSV.
- Fix: prefix formula-like text cells with an apostrophe (or another documented neutralization strategy) before RFC 4180 quoting; add tests for all formula prefixes. Keep numeric fields numeric.
- Mitigation: generated XLSX currently writes text using `inlineStr`, not formula cells.
- False-positive notes: behavior varies by spreadsheet application and security settings, but neutralization is appropriate for downloadable administrative exports.

### SEC-007 — Backup manifests do not contain the documented integrity checksum

- Rule ID: BACKUP-INTEGRITY-001
- Severity: Medium
- Location: `src/workflows/backup.ts`, lines 23-30; `docs/restore.md`, lines 5-9
- Evidence: the Workflow streams the SQL dump to private R2 and records bookmark/time/object key, but does not compute or store a digest. The restore procedure instructs operators to verify a checksum/metadata that the Workflow does not produce. No durable restore-drill evidence is tracked in the repository.
- Impact: accidental truncation, corruption, or wrong-object selection may not be detected before restore; the documented recovery procedure cannot currently perform its stated checksum validation.
- Fix: compute SHA-256 while exporting or in a subsequent Workflow step, store size and digest in the manifest, verify them during a scripted disposable restore drill, and retain drill evidence.
- Mitigation: R2 is private, D1 Time Travel provides a second recovery mechanism, and the latest production verification Workflow completed successfully.
- False-positive notes: R2 transport/storage integrity exists underneath the application; this finding concerns explicit operational verification and restore assurance.

## Low findings

### SEC-008 — GitHub supply-chain protections are incomplete

- Rule ID: REACT-SUPPLY-001
- Severity: Low
- Location: `.github/workflows/ci.yml`, lines 8-9; `.github/workflows/deploy.yml`, lines 10-12 and 20; live repository settings inspected 2026-09-14
- Evidence: Actions are referenced by mutable major tags rather than commit SHAs; repository Actions policy allows all actions and does not require SHA pinning; Dependabot security updates, secret scanning, push protection, and validity checks are disabled. `npm audit` found four moderate advisories in the development-only Drizzle Kit/esbuild chain and zero high/critical advisories.
- Impact: a compromised action tag or accidentally committed credential would have fewer preventive/detection controls. The current dev-server advisory does not affect the deployed Worker runtime.
- Fix: pin Actions to reviewed commit SHAs, restrict allowed actions, enable Dependabot security updates and GitHub secret scanning/push protection, and monitor the Drizzle Kit dependency chain rather than applying npm's unsafe downgrade suggestion.
- Mitigation: `main` requires PRs, linear history, and the `quality` check; workflow permissions are explicitly `contents: read`; installs use the lockfile through `npm ci`.
- False-positive notes: GitHub's displayed source tag is easier to read but is mutable; SHA pinning is the stronger supply-chain control.

### SEC-009 — Retailer URLs accept non-web schemes

- Rule ID: REACT-URL-001
- Severity: Low
- Location: `src/domain/contracts.ts`, line 37; `src/ui/App.tsx`, retailer link rendering, line 69
- Evidence: `z.url()` accepts `javascript:`, `data:`, and `ftp:` syntactically. React 19 blocks direct `javascript:` links and the UI uses `target="_blank" rel="noreferrer"`, substantially reducing immediate exploitability, but the contract does not enforce the intended Lowe's/Home Depot HTTPS-link use case.
- Impact: an authorized or compromised user could store a confusing or unsafe external scheme and induce another user to open it.
- Fix: refine the schema to permit only `https:` (optionally `http:` for explicit localhost tests) and add unit tests.
- Mitigation: React's URL protection and `noreferrer` are active.
- False-positive notes: no server-side fetch follows this URL, so this is not SSRF.

### SEC-010 — Expensive authenticated operations have no application rate/size guard

- Rule ID: WORKER-RESOURCE-001
- Severity: Low
- Location: `src/api/routes.ts`, full export, lines 158-161; artifact generation, lines 164-175
- Evidence: any authorized identity can repeatedly load every table into memory, synchronously ZIP the full export, or invoke Browser Run PDF generation. No per-user rate limit or maximum job-line count is enforced.
- Impact: a compromised allowlisted account could create avoidable Worker/Browser Run cost or availability pressure; sufficiently large data could approach Worker memory limits.
- Fix: add conservative per-identity rate limits for estimate generation/export, cap line-item counts and document input size, and stream large exports if growth warrants it.
- Mitigation: only four exact identities can authenticate, input fields are individually bounded, and current use is low volume.
- False-positive notes: this is a resilience control, not a demonstrated present-day outage.

## Verified controls and positive observations

- Access JWTs are validated with remote JWKS, exact issuer/audience, RS256, `type=app`, and an application-side exact-email allowlist (`src/api/auth.ts`, lines 5-20).
- Both production and staging Access applications use reusable default-deny policies, one Google IdP, 12-hour sessions, and HttpOnly cookies. The four intended email identities are the only interactive includes.
- Production and staging artifact/backup R2 buckets have disabled `r2.dev` domains and no custom domains.
- `workers.dev` and preview URLs are disabled; the custom domains redirect unauthenticated UI and API requests to Access.
- D1 statements use bound parameters; the one dynamic table-name query uses a fixed internal allowlist (`src/api/routes.ts`, lines 158-160).
- Request schemas are strict and impose length/value bounds (`src/domain/contracts.ts`).
- React renders stored text through normal escaped JSX. No `dangerouslySetInnerHTML`, DOM HTML injection, `eval`, Web Storage token, `postMessage`, third-party script, or service-worker pattern was found.
- PDF and XLSX generators escape untrusted HTML/XML text (`src/documents/pdf.ts`, line 5; `src/documents/xlsx.ts`, line 4).
- Artifact responses stream private R2 bodies through authenticated UUID endpoints with `attachment`, `private, no-store`, and `nosniff` (`src/api/routes.ts`, lines 150-155).
- Estimate snapshots are immutable through the exposed API, and generated files are checksummed before artifact metadata is recorded.
- Structured logs record method/path/status/actor but not request bodies, customer addresses, tokens, or document contents. Logs and traces are enabled with sampling (`src/worker.ts`, lines 15-16; `wrangler.jsonc`, line 27).
- A history-wide high-signal secret regex scan found no credential literal. This complements but does not replace enabling GitHub secret scanning.

## Recommended remediation order

1. Restrict the smoke service identity to the health endpoint and rotate it.
2. Remove production credentials from PR CI and move deploy/smoke secrets to the protected production environment; rotate them.
3. Add static-asset security headers and stop publishing source maps.
4. Enforce HTTPS retailer URLs and neutralize CSV formulas.
5. Enforce MFA after testing all four accounts.
6. Move OpenTofu state to an encrypted backend and make the local copy owner-only.
7. Add backup digests plus a scripted, evidenced restore drill.
8. Pin GitHub Actions, enable repository security automation, and add conservative rate limits.

## Reference guidance

- [Cloudflare Access application-token validation and full identity](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare Access session management and logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Cloudflare Access MFA requirements](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)
- [Cloudflare R2 public-domain controls](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/)
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [GitHub secure use of third-party actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
