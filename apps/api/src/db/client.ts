import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(databaseUrl = Bun.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Postgres-backed runtime operations.");
  }

  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}

export type CooeeDb = ReturnType<typeof createDb>;
