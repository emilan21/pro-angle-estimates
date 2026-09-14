import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type AccessIdentity = { email: string; subject: string };

export async function verifyAccessJwt(token: string, teamDomain: string, audience: string, allowedEmail: string, smokeClientId?: string): Promise<AccessIdentity> {
  const issuer = teamDomain.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] });
  return identityFromPayload(payload, allowedEmail, smokeClientId);
}

export function identityFromPayload(payload: JWTPayload, allowedEmail: string, smokeClientId?: string): AccessIdentity {
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (payload.type !== "app") throw new Error("Identity is not authorized");
  const commonName = typeof payload.common_name === "string" ? payload.common_name : "";
  const isSmokeToken = Boolean(smokeClientId && (commonName === smokeClientId || commonName === `${smokeClientId}.access` || payload.service_token_id === smokeClientId));
  if (isSmokeToken) return { email: `service:${smokeClientId}`, subject: payload.sub ?? "" };
  if (!email || email !== allowedEmail.toLowerCase()) throw new Error("Identity is not authorized");
  return { email, subject: payload.sub ?? "" };
}
