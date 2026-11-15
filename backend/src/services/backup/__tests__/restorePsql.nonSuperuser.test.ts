import { Client } from "pg";
import {
  CLEAN_SCHEMA_PREAMBLE,
  SOFT_CLEAN_SCHEMA_PREAMBLE,
  createNonSuperuserDumpFilter,
} from "../restorePsql";

async function filtered(chunks: (string | Buffer)[]): Promise<string> {
  const filter = createNonSuperuserDumpFilter();
  const out: string[] = [];
  filter.on("data", (d: Buffer) => out.push(d.toString()));
  const done = new Promise<void>((resolve) => filter.on("end", resolve));
  for (const c of chunks) filter.write(c);
  filter.end();
  await done;
  return out.join("");
}

const DUMP = [
  "DROP EXTENSION IF EXISTS postgis;",
  "DROP SCHEMA IF EXISTS tiger;",
  "DROP TABLE IF EXISTS public.users;",
  "COMMENT ON EXTENSION postgis IS 'PostGIS';",
  "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;",
  "COPY public.spatial_ref_sys (srid, auth_name) FROM stdin;",
  "1\tEPSG",
  "\\.",
  "COPY tiger.geocode_settings (name) FROM stdin;",
  "x",
  "\\.",
  "COPY public.notes (id, body) FROM stdin;",
  "1\tDROP EXTENSION IF EXISTS postgis;",
  "2\tCOPY public.spatial_ref_sys (srid) FROM stdin;",
  "\\.",
  "SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);",
  "SELECT pg_catalog.setval('public.users_seq', 5, true);",
  "",
].join("\n");

describe("dump filter for a non-superuser restore (forgejo#415 N5)", () => {
  it("drops the statements that need extension ownership and keeps everything else", async () => {
    const out = await filtered([DUMP]);
    expect(out).not.toMatch(/^DROP EXTENSION/m);
    expect(out).not.toMatch(/^COMMENT ON EXTENSION/m);
    expect(out).not.toMatch(/^DROP SCHEMA IF EXISTS tiger/m);
    expect(out).not.toContain("spatial_ref_sys (srid, auth_name)");
    expect(out).not.toContain("tiger.geocode_settings");
    expect(out).not.toContain("topology_id_seq");
    expect(out).toContain("DROP TABLE IF EXISTS public.users;");
    expect(out).toContain("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;");
    expect(out).toContain("SELECT pg_catalog.setval('public.users_seq', 5, true);");
  });

  it("never mistakes a COPY data row for a statement", async () => {
    const out = await filtered([DUMP]);
    expect(out).toContain("1\tDROP EXTENSION IF EXISTS postgis;");
    expect(out).toContain("2\tCOPY public.spatial_ref_sys (srid) FROM stdin;");
  });

  it("keeps a multibyte character that arrives split across two chunks", async () => {
    const bytes = Buffer.from(
      "COPY public.notes (id, body) FROM stdin;\n1\tMünchen 日本\n\\.\n",
      "utf8"
    );
    for (let cut = 1; cut < bytes.length; cut++) {
      const out = await filtered([bytes.subarray(0, cut), bytes.subarray(cut)]);
      expect(out).toBe(bytes.toString("utf8"));
    }
  });

  it("gives the same result when the dump arrives in arbitrary chunks", async () => {
    const whole = await filtered([DUMP]);
    const pieces: string[] = [];
    for (let i = 0; i < DUMP.length; i += 7) pieces.push(DUMP.slice(i, i + 7));
    expect(await filtered(pieces)).toBe(whole);
  });
});

describe("soft clean preamble (forgejo#415 N5)", () => {
  it("keeps the schema, so the superuser-only DROP SCHEMA ... CASCADE is gone", () => {
    expect(SOFT_CLEAN_SCHEMA_PREAMBLE).not.toMatch(/DROP SCHEMA/i);
    expect(CLEAN_SCHEMA_PREAMBLE).toMatch(/DROP SCHEMA IF EXISTS public CASCADE/);
  });

  it("empties public of the app's objects and leaves postgis in place", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE soft_clean_t (id int primary key, v text)");
      await client.query("CREATE VIEW soft_clean_v AS SELECT * FROM soft_clean_t");
      await client.query("CREATE TYPE soft_clean_e AS ENUM ('a')");
      await client.query("CREATE SEQUENCE soft_clean_s");
      await client.query("CREATE FUNCTION soft_clean_f() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      const before = await client.query("SELECT count(*)::int AS n FROM spatial_ref_sys");
      await client.query(SOFT_CLEAN_SCHEMA_PREAMBLE);
      const left = await client.query(
        `SELECT
           to_regclass('soft_clean_t') AS t, to_regclass('soft_clean_v') AS v,
           to_regclass('soft_clean_s') AS s,
           (SELECT count(*)::int FROM pg_type WHERE typname = 'soft_clean_e') AS e,
           (SELECT count(*)::int FROM pg_proc WHERE proname = 'soft_clean_f') AS f`
      );
      expect(left.rows[0]).toEqual({ t: null, v: null, s: null, e: 0, f: 0 });
      const after = await client.query("SELECT count(*)::int AS n FROM spatial_ref_sys");
      expect(after.rows[0].n).toBe(before.rows[0].n);
      const st = await client.query(
        "SELECT ST_Distance('POINT(0 0)'::geometry, 'POINT(3 4)'::geometry) AS d"
      );
      expect(st.rows[0].d).toBe(5);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});
