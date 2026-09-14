import { describe, expect, it } from "vitest";
import { identityFromPayload } from "../src/api/auth";

const allowedEmails = "proangleconstruction@gmail.com,eprogram1@gmail.com,emilan@ericmilan.dev,edingerkevin75@gmail.com";

describe("Access identity", () => {
  it("accepts allowlisted users case-insensitively", () => {
    expect(identityFromPayload({ type: "app", email: "ProAngleConstruction@gmail.com", sub: "owner" }, allowedEmails).email).toBe("proangleconstruction@gmail.com");
    expect(identityFromPayload({ type: "app", email: "EMILAN@ERICMILAN.DEV", sub: "user" }, allowedEmails).email).toBe("emilan@ericmilan.dev");
  });
  it("accepts the designated smoke service token", () => expect(identityFromPayload({ type: "app", common_name: "smoke.access" }, allowedEmails, "smoke").email).toBe("service:smoke"));
  it("rejects unauthorized identities", () => expect(() => identityFromPayload({ type: "app", email: "other@gmail.com" }, allowedEmails)).toThrow());
  it("rejects non-application tokens", () => expect(() => identityFromPayload({ type: "org", email: "proangleconstruction@gmail.com" }, allowedEmails)).toThrow());
});
