import type { Hono } from "hono";
import type { Env } from "../env";
import type { ProtocolRuntime } from "./types";
import {
  createWhatsAppRuntime,
  registerWhatsAppSetupRoutes,
  type WhatsAppRuntime,
} from "./whatsapp";

export interface ProtocolAdapter {
  name: string;
  createRuntime(env: Env): ProtocolRuntime;
  registerSetupRoutes(app: Hono, env: Env, runtime: ProtocolRuntime): void;
  getHealth(runtime: ProtocolRuntime): { ready: boolean; hasSetupCode: boolean };
}

const whatsappAdapter: ProtocolAdapter = {
  name: "whatsapp",
  createRuntime(env) {
    return createWhatsAppRuntime(env);
  },
  registerSetupRoutes(app, env, runtime) {
    registerWhatsAppSetupRoutes(app, env, runtime as WhatsAppRuntime);
  },
  getHealth(runtime) {
    return {
      ready: runtime.isReady(),
      hasSetupCode: Boolean(runtime.getLatestSetupCode()),
    };
  },
};

const adapters = new Map<string, ProtocolAdapter>([[whatsappAdapter.name, whatsappAdapter]]);

export function getProtocolAdapter(name: string): ProtocolAdapter {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new Error(`Unsupported chat protocol: ${name}`);
  }
  return adapter;
}
