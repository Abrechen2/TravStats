/**
 * Test helper: a second, migrated database for a second in-process server (spec 2026-10-20,
 * two-instance tests). Not a suite (no `.test.ts` suffix).
 *
 * Named after the run's own database — `<db>` ending `_test` becomes `<db minus _test>b_test`,
 * anything else `<db>_peer_test` — so it carries an expendable suffix (`jest.globalSetup.ts`)
 * and a parallel run's worker databases each get their own peer. It is created from
 * `template_postgis` (the PostGIS image's template, which CI's service image has too) rather
 * than copied from the run's database: `CREATE DATABASE … TEMPLATE` refuses a source with open
 * connections, and the worker running this file holds some. A database left by an earlier run is
 * reused; `prisma migrate deploy` brings it to this branch's migrations either way.
 */
import { execFileSync } from "child_process";
import path from "path";
import { Client } from "pg";

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function peerDatabaseUrl(base = process.env.DATABASE_URL ?? ""): string {
  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const peer = name.endsWith("_test")
    ? `${name.slice(0, -"_test".length)}b_test`
    : `${name}_peer_test`;
  url.pathname = `/${encodeURIComponent(peer)}`;
  return url.toString();
}

export async function preparePeerDatabase(): Promise<string> {
  const peerUrl = peerDatabaseUrl();
  const parsed = new URL(peerUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const maintenance = new URL(peerUrl);
  maintenance.pathname = "/postgres";
  maintenance.search = "";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0)
      await client.query(`CREATE DATABASE ${quote(name)} TEMPLATE template_postgis`);
  } finally {
    await client.end();
  }
  const cliUrl = new URL(peerUrl);
  cliUrl.search = "";
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.join(__dirname, "..", "..", "..", "..", ".."),
    env: { ...process.env, DATABASE_URL: cliUrl.toString() },
    stdio: "pipe",
    timeout: 300_000,
  });
  return peerUrl;
}
