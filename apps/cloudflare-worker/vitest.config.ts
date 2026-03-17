import {
  cloudflarePool,
  cloudflareTest,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const poolOptions = {
  main: "./src/index.ts",
  miniflare: {
    bindings: {
      WHATSAPP_VERIFY_TOKEN: "test-verify-token",
      WHATSAPP_APP_SECRET: "test-app-secret",
      WHATSAPP_ACCESS_TOKEN: "test-whatsapp-access-token",
      OPENROUTER_API_KEY: "test-openrouter-api-key",
      OPENROUTER_MODEL: "openrouter/auto",
      OPENROUTER_SYSTEM_PROMPT: "Be concise.",
      OPENROUTER_SITE_URL: "https://example.test",
      OPENROUTER_APP_TITLE: "Herder Test",
    },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(poolOptions)],
  test: {
    pool: cloudflarePool(poolOptions),
  },
});
