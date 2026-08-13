import { InMemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";
import { isProductionRuntime } from "../config";

export function createStore(
  env: Record<string, string | undefined> = Bun.env,
): Store {
  if (env.DATABASE_URL) {
    return PostgresStore.fromDatabaseUrl(env.DATABASE_URL);
  }

  if (isProductionRuntime(env)) {
    throw new Error("DATABASE_URL is required in production.");
  }

  return InMemoryStore.seeded();
}
