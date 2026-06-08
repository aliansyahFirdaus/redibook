import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type Database = Pool;

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  return new Pool({ connectionString, max: 10 });
}

export async function withTransaction<T>(
  database: Database,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function oneOrNull<T extends QueryResultRow>(
  database: Pick<Database, "query">,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await database.query<T>(text, values);
  return result.rows[0] ?? null;
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
