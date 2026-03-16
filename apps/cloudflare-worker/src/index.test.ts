import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const APP_SECRET = "test-app-secret";

async function hmacSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("POST /webhooks", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  it("returns 401 when X-Hub-Signature-256 header is missing", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when header lacks sha256= prefix", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "notvalid",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256":
          "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 when signature is valid", async () => {
    const hex = await hmacSignature(body);
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": `sha256=${hex}`,
      },
      body,
    });
    expect(res.status).toBe(200);
  });
});
