import { describe, expect, it } from "vitest";
import { canAccessRequest, identityFromPayload } from "../src/api/auth";

const allowedEmails = "proangleconstruction@gmail.com,eprogram1@gmail.com,emilan@ericmilan.dev,edingerkevin75@gmail.com,milantina74@gmail.com";

describe("Access identity", () => {
  it("accepts allowlisted users case-insensitively", () => {
    expect(identityFromPayload({ type: "app", email: "ProAngleConstruction@gmail.com", sub: "owner" }, allowedEmails).email).toBe("proangleconstruction@gmail.com");
    expect(identityFromPayload({ type: "app", email: "EMILAN@ERICMILAN.DEV", sub: "user" }, allowedEmails).email).toBe("emilan@ericmilan.dev");
    expect(identityFromPayload({ type: "app", email: "milantina74@gmail.com", sub: "user" }, allowedEmails).email).toBe("milantina74@gmail.com");
  });
  it("accepts the designated smoke service token", () => expect(identityFromPayload({ type: "app", common_name: "smoke.access" }, allowedEmails, "smoke").email).toBe("service:smoke"));
  it("limits the smoke service identity to the GET health check", () => {
    const service = { email: "service:smoke", subject: "smoke" };
    expect(canAccessRequest(service, "GET", "/api/v1/health")).toBe(true);
    expect(canAccessRequest(service, "POST", "/api/v1/health")).toBe(false);
    expect(canAccessRequest(service, "GET", "/api/v1/customers")).toBe(false);
    expect(canAccessRequest(service, "GET", "/")).toBe(false);
    expect(canAccessRequest({ email: "emilan@ericmilan.dev", subject: "user" }, "DELETE", "/api/v1/customers/id")).toBe(true);
  });
  it("rejects unauthorized identities", () => expect(() => identityFromPayload({ type: "app", email: "other@gmail.com" }, allowedEmails)).toThrow());
  it("rejects non-application tokens", () => expect(() => identityFromPayload({ type: "org", email: "proangleconstruction@gmail.com" }, allowedEmails)).toThrow());
});
