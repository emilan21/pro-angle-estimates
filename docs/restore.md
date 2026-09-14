# D1 restore procedure

Perform this drill before launch and quarterly. Never restore over production during a drill.

1. Record the target backup key, its manifest, checksum/metadata, and D1 Time Travel bookmark.
2. Create a disposable D1 database: `npx wrangler d1 create pro-angle-estimates-restore-drill`.
3. Download the private SQL object from the backup R2 bucket through an administrator-authenticated process.
4. Verify the downloaded file against its manifest metadata, then import it into the disposable database with `npx wrangler d1 execute pro-angle-estimates-restore-drill --remote --file=<dump.sql>`.
5. Run relationship checks: no orphaned jobs, job lines, retailer offers, price history, estimate snapshots, adjustments, or artifacts; compare row counts to the manifest.
6. Generate and download one historical estimate in each format, confirming totals and snapshot values agree.
7. Record drill date, backup key/bookmark, verifier, row counts, and result in the operations log. Delete the disposable database only after evidence is retained.

For an actual incident, first disable deployments, record the current Time Travel bookmark, and choose either point-in-time restore or a validated R2 export. Take a new backup before changing production. Application rollback does not roll back D1 or R2 data.
