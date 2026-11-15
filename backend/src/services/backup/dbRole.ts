import { Client } from "pg";
import logger from "../../utils/logger";

/** Schemas that belong to postgis_tiger_geocoder / postgis_topology and that only their owner can read. */
export const EXTENSION_SCHEMA_EXCLUDES = ["-N", "tiger", "-N", "tiger_data", "-N", "topology"];

interface DbConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/**
 * True only when the connection is proven to be an ordinary (non-superuser)
 * role. Backup and restore take the superuser path otherwise — the behaviour
 * every existing install has run so far — so a failed check can never switch an
 * install onto the new path by accident (forgejo#415 N5). The dump or psql that
 * follows reports a genuinely unreachable database itself.
 */
export async function isNonSuperuserRole(db: DbConnection): Promise<boolean> {
  const client = new Client({
    host: db.host,
    port: Number(db.port),
    user: db.user,
    password: db.password,
    database: db.database,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const res = await client.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
    );
    return res.rows[0]?.rolsuper === false;
  } catch (error) {
    logger.warn({
      operation: "db_role_check_failed",
      message: `Could not read the database role; using the superuser backup path: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
