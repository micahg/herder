import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createServer } from "node:net";
import { loadEnv } from "./env";
import { getProtocolAdapter } from "./protocols/index";

const env = loadEnv();
const protocolAdapter = getProtocolAdapter(env.CHAT_PROTOCOL);
const runtime = protocolAdapter.createRuntime(env);
const app = new Hono();
let shutdownPromise: Promise<void> | null = null;

runtime.initialize().catch(async (error: unknown) => {
  console.error("Failed to initialize WhatsApp runtime", error);
  await shutdown("runtime initialization failure", 1);
});

app.get("/health", (c) => {
  const health = protocolAdapter.getHealth(runtime);
  return c.json({
    ok: true,
    protocol: protocolAdapter.name,
    ready: health.ready,
    hasSetupCode: health.hasSetupCode,
    hasQr: health.hasSetupCode,
  });
});

protocolAdapter.registerSetupRoutes(app, env, runtime);

const listenPort = await resolveAvailablePort(env.PORT);

const server = serve({
  fetch: app.fetch,
  port: listenPort,
});

if (listenPort !== env.PORT) {
  console.warn(
    `Port ${env.PORT} is in use. Started whatsapp-web bot on :${listenPort} instead.`
  );
} else {
  console.log(`whatsapp-web bot listening on :${listenPort}`);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log(`Shutting down whatsapp-web bot (${reason})...`);

    const [runtimeResult, serverResult] = await Promise.allSettled([
      runtime.shutdown(),
      closeServer(server),
    ]);

    if (runtimeResult.status === "rejected") {
      console.error("Failed while shutting down WhatsApp runtime", runtimeResult.reason);
    }

    if (serverResult.status === "rejected") {
      console.error("Failed while closing HTTP server", serverResult.reason);
    }

    process.exitCode =
      runtimeResult.status === "rejected" || serverResult.status === "rejected"
        ? 1
        : exitCode;

    process.exit();
  })();

  return shutdownPromise;
}

function closeServer(serverToClose: unknown): Promise<void> {
  if (
    !serverToClose ||
    typeof serverToClose !== "object" ||
    !("close" in serverToClose) ||
    typeof serverToClose.close !== "function"
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const close = serverToClose.close as (callback: (error?: Error) => void) => void;
    close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        server.close();
        if (error.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    };

    tryPort(startPort);
  });
}
