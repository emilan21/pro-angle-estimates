import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

type ExportResponse = { success: boolean; errors?: Array<{ message: string }>; result?: { at_bookmark?: string; signed_url?: string; filename?: string } };
type BackupPayload = { cron?: string; scheduledTime?: number };

export class BackupWorkflow extends WorkflowEntrypoint<Env, BackupPayload> {
  async run(event: WorkflowEvent<BackupPayload>, step: WorkflowStep): Promise<void> {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.env.ACCOUNT_ID}/d1/database/${this.env.DATABASE_ID}/export`;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${this.env.D1_REST_API_TOKEN}` };
    const bookmark = await step.do("start D1 export", { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" } }, async () => {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ output_format: "polling" }) });
      const body = await response.json<ExportResponse>(); if (!response.ok || !body.result?.at_bookmark) throw new Error(body.errors?.[0]?.message ?? "D1 export did not return a bookmark"); return body.result.at_bookmark;
    });
    await step.do("download and store D1 export", { retries: { limit: 12, delay: "30 seconds", backoff: "constant" } }, async () => {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ current_bookmark: bookmark }) });
      const body = await response.json<ExportResponse>(); if (!response.ok || !body.result?.signed_url || !body.result.filename) throw new Error(body.errors?.[0]?.message ?? "D1 export is not ready");
      const dump = await fetch(body.result.signed_url); if (!dump.ok || !dump.body) throw new Error("Could not download D1 export");
      const scheduledAt = new Date(event.payload.scheduledTime ?? event.timestamp).toISOString();
      const date = scheduledAt.slice(0, 10), dailyKey = `daily/${date}/${body.result.filename}`, metadata = { bookmark, exportedAt: scheduledAt };
      const keys = [dailyKey];
      if (date.endsWith("-01")) keys.push(`monthly/${date.slice(0, 7)}/${body.result.filename}`);
      if (keys.length === 2) { const [dailyStream, monthlyStream] = dump.body.tee(); await Promise.all([this.env.BACKUPS.put(keys[0], dailyStream, { customMetadata: metadata }), this.env.BACKUPS.put(keys[1], monthlyStream, { customMetadata: metadata })]); }
      else await this.env.BACKUPS.put(dailyKey, dump.body, { customMetadata: metadata });
      await Promise.all(keys.map((objectKey) => this.env.BACKUPS.put(`${objectKey}.manifest.json`, JSON.stringify({ schemaVersion: 1, databaseId: this.env.DATABASE_ID, bookmark, exportedAt: scheduledAt, objectKey }), { httpMetadata: { contentType: "application/json" } })));
    });
  }
}
