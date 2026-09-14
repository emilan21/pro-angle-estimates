# Production operations

## Initial provisioning

1. Repair `gh auth` and apply `infra/` to create the private repository, branch ruleset, Workers, D1 databases, R2 buckets/lifecycle policies, Access apps/policy/service token, and custom domains.
2. Configure Google as the Access identity provider with the existing Access callback domain and OAuth scopes `openid`, `email`, and `profile`.
3. Copy the generated D1 IDs and Access AUD tags into each Wrangler environment. Set Worker and GitHub environment secrets; never place secret values in Git or logs.
4. Push through a pull request. The protected `main` branch requires the `quality` check and linear history, with no outside approval requirement for the sole maintainer.
5. Confirm production rejects other Google identities, missing/expired/wrong-audience JWTs, and direct Worker access.

## Backups and retention

The scheduled Workflow starts a D1 export, polls the Cloudflare export API, streams the SQL dump to private R2, and writes a manifest. On the first of each month the stream is also stored under `monthly/`. `daily/` objects expire after 90 days; monthly objects expire after 396 days (at least 13 months). Workflow failures appear in Worker/Workflow logs and must be investigated the same business day.

## Launch checklist

- Production is reachable only through the Access-protected custom domain.
- New web D1 databases are empty; no Google Drive data is imported.
- PDF/XLSX/CSV downloads agree and R2 objects are private.
- A catalog change does not alter an existing job line; a job edit does not alter an issued version.
- Short and multi-page PDF fixtures have been rasterized and visually inspected.
- Full-export reconstruction and a disposable D1 restore drill pass.
- The legacy Google Drive estimate generation remains operational after its separately reviewed branding-only correction.
