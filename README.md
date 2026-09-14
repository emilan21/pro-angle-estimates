# Pro Angle Estimates

Private estimate management for Pro Angle Construction. This is a standalone TypeScript application; it does not read from, synchronize with, or modify the existing Google Drive / Apps Script system.

## Architecture

- React 19, Vite, and Tailwind CSS 4 SPA served by Workers Static Assets
- Hono `/api/v1` Worker API with Zod validation
- Drizzle schema over Cloudflare D1; integer cents for all money
- private R2 artifacts and D1 SQL backups
- Browser Run raw-HTML PDF generation
- Cloudflare Access JWT verification (issuer, audience, signature, token type, and exact identity)
- OpenTofu for production/staging resources and GitHub repository protection

## Local setup

1. `npm install`
2. Copy `.env.example` to `.dev.vars` and replace placeholders. Localhost can use `LOCAL_DEV_BYPASS=true`; production is fixed to `false`.
3. `npm run types`
4. `npm run db:migrate:local`
5. `npm run dev`

Before deploying, replace placeholder D1 IDs, Access team domain, audience, account ID, and database ID in `wrangler.jsonc` from OpenTofu outputs. Add `D1_REST_API_TOKEN` and `SMOKE_ACCESS_CLIENT_ID` with `wrangler secret put`. The GitHub production environment also requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SMOKE_ACCESS_CLIENT_ID`, and `SMOKE_ACCESS_CLIENT_SECRET`.

## Verification

Run `npm run typecheck && npm run lint && npm test && npm audit --audit-level=high && npm run build && npm run deploy:dry`. Apply migrations to a local D1 database with `npm run db:migrate:local`.

## Security properties

- `workers.dev` and preview URLs are disabled.
- Every request, including static assets, requires a verified Access application JWT.
- Interactive access is restricted to `proangleconstruction@gmail.com`; one scoped Access service token supports CI smoke tests.
- Artifact R2 buckets have no public domain. Downloads stream through authenticated endpoints with `private, no-store`.
- Logs contain request metadata and actor identity, never customer bodies, addresses, tokens, or documents.
- Estimate versions copy all customer, job, line-item, adjustment, and price data into immutable rows.

See [restore.md](docs/restore.md) and [operations.md](docs/operations.md) before launch.
