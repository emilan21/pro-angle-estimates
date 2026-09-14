import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type AccessIdentity = { email: string; subject: string };

const smokeHealthPath = "/api/v1/health";

export function canAccessRequest(identity: AccessIdentity, method: string, path: string): boolean {
  if (!identity.email.startsWith("service:")) return true;
  return method.toUpperCase() === "GET" && path === smokeHealthPath;
}

export async function verifyAccessJwt(token: string, teamDomain: string, audience: string, allowedEmails: string, smokeClientId?: string): Promise<AccessIdentity> {
  const issuer = teamDomain.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] });
  return identityFromPayload(payload, allowedEmails, smokeClientId);
}

export function identityFromPayload(payload: JWTPayload, allowedEmails: string | readonly string[], smokeClientId?: string): AccessIdentity {
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (payload.type !== "app") throw new Error("Identity is not authorized");
  const commonName = typeof payload.common_name === "string" ? payload.common_name : "";
  const isSmokeToken = Boolean(smokeClientId && (commonName === smokeClientId || commonName === `${smokeClientId}.access` || payload.service_token_id === smokeClientId));
  if (isSmokeToken) return { email: `service:${smokeClientId}`, subject: payload.sub ?? "" };
  const allowlist = (typeof allowedEmails === "string" ? allowedEmails.split(",") : allowedEmails).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowlist.includes(email)) throw new Error("Identity is not authorized");
  return { email, subject: payload.sub ?? "" };
}
