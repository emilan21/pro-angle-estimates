import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./api/routes";
import { canAccessRequest, verifyAccessJwt } from "./api/auth";

type AppBindings = { Bindings: Env; Variables: { actorEmail: string } };
const app = new Hono<AppBindings>();
app.use("*", secureHeaders({ contentSecurityPolicy: { defaultSrc: ["'self'"], baseUri: ["'self'"], connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "data:"], objectSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] }, strictTransportSecurity: "max-age=31536000; includeSubDomains", referrerPolicy: "no-referrer", permissionsPolicy: { camera: [], geolocation: [], microphone: [] }, xFrameOptions: "DENY" }));
app.use("*", async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  try {
    if (String(c.env.LOCAL_DEV_BYPASS) === "true" && new URL(c.req.url).hostname === "localhost") c.set("actorEmail", c.env.ALLOWED_EMAILS.split(",")[0].trim());
    else { const token = c.req.header("cf-access-jwt-assertion"); if (!token) return c.json({ error: { code: "AUTH_REQUIRED", message: "Cloudflare Access authentication is required." } }, 401); const identity = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD, c.env.ALLOWED_EMAILS, c.env.SMOKE_ACCESS_CLIENT_ID); if (!canAccessRequest(identity, c.req.method, c.req.path)) return c.json({ error: { code: "FORBIDDEN", message: "Service credentials may only access the health check." } }, 403); c.set("actorEmail", identity.email); }
    await next();
    console.log(JSON.stringify({ message: "request", requestId, method: c.req.method, path: c.req.path, status: c.res.status, actor: c.get("actorEmail") }));
  } catch (error) { console.error(JSON.stringify({ message: "request failed", requestId, method: c.req.method, path: c.req.path, error: error instanceof Error ? error.message : "unknown" })); return c.json({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403); }
});
app.route("/api/v1", api);
app.notFound(async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(env.BACKUP_WORKFLOW.create({
      id: `backup-${controller.scheduledTime}`,
      params: { cron: controller.cron, scheduledTime: controller.scheduledTime },
    }));
  },
} satisfies ExportedHandler<Env>;
export { BackupWorkflow } from "./workflows/backup";
