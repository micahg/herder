import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

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

describe("GET /webhooks", () => {
  it("returns challenge when mode/token are valid", async () => {
    const challenge = "test-challenge";
    const res = await SELF.fetch(
      `http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(challenge);
  });

  it("returns 400 when verify token is wrong", async () => {
    const res = await SELF.fetch(
      "http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test-challenge"
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when challenge is missing", async () => {
    const res = await SELF.fetch(
      `http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /privacy", () => {
  it("returns 200 with markdown privacy policy", async () => {
    const res = await SELF.fetch("http://localhost/privacy");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");

    const body = await res.text();
    expect(body).toContain("# Privacy Policy");
    expect(body).toContain("Steakholder Meating");
  });
});
