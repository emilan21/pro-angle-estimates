export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | Array<{ message?: string }> | null;
    const message = Array.isArray(body) ? body[0]?.message : body?.error?.message;
    throw new Error(message ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export type AccessIdentity = { name: string; email: string };

export function accessIdentityFromUnknown(value: unknown): AccessIdentity {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const email = typeof record.email === "string" ? record.email.trim().slice(0, 254) : "";
  const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
  return { name: name || email.split("@")[0] || "Authorized user", email };
}

export async function getAccessIdentity(): Promise<AccessIdentity> {
  const response = await fetch("/cdn-cgi/access/get-identity", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Could not load the signed-in Google profile.");
  return accessIdentityFromUnknown(await response.json());
}
