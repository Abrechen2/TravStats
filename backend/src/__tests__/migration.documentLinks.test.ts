import fs from "fs";
import path from "path";
import { Client, types } from "pg";

/**
 * `document_links` (plan docs/superpowers/specs/2026-11-21-document-links.md,
 * phase D1) on a database that already holds documents of every old shape:
 * filed with each of the ten owner columns, a receipt filed with a flight, a
 * rental's categorised evidence, and an unfiled upload.
 *
 * Like `migration.travtrackShareRecordedSeq.test.ts`, it builds the database as
 * it stands before the migration in a throw-away database, writes rows in that
 * shape, applies the migration, and then checks what the expand step promises:
 * every filed document is ONE primary/legacy link to the entry it was filed
 * with, nothing unfiled gains a link, no document row changes, and deleting an
 * entry now leaves the document — unfiled, with its grace clock started —
 * instead of cascading it away.
 */

// Prisma stores UTC in `timestamp without time zone`; read it back as UTC, not
// in the host's zone (the default parser), so the assertions hold everywhere.
types.setTypeParser(types.builtins.TIMESTAMP, (value) => new Date(`${value.replace(" ", "T")}Z`));

const MIGRATIONS = path.join(__dirname, "../../prisma/migrations");
const NEW = "20261121094913_document_links";
const DB = `migtest_document_links_${process.pid}`;

function migrationSql(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf-8");
}

function earlierMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((name) => fs.existsSync(path.join(MIGRATIONS, name, "migration.sql")))
    .filter((name) => name !== NEW && (name < NEW || name.startsWith("99999999")))
    .sort();
}

function baseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url.split("?")[0];
}

const withDatabase = (url: string, db: string) => url.replace(/\/[^/]+$/, `/${db}`);

const USER = "u-docs";
const OWNER_COLUMNS = [
  ["flight_id", "flights"],
  ["cruise_id", "cruises"],
  ["lodging_stay_id", "lodging_stays"],
  ["trip_id", "trips"],
  ["place_visit_id", "place_visits"],
  ["rail_journey_id", "rail_journeys"],
  ["rental_booking_id", "rental_bookings"],
  ["bus_journey_id", "bus_journeys"],
  ["ferry_journey_id", "ferry_journeys"],
  ["trip_expense_id", "trip_expenses"],
] as const;

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
}

/**
 * Inserts a minimal row into `table` and returns its id: every NOT NULL column
 * without a default gets a value of its type, and a foreign key gets a row of
 * its own first. Spares the test a hand-kept copy of ten tables' required
 * columns, which would rot with the next migration that adds one.
 */
async function insertMinimal(
  db: Client,
  table: string,
  id: string,
  extra: Record<string, string> = {}
): Promise<string> {
  const columns = (
    await db.query<ColumnInfo>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
         AND is_nullable = 'NO' AND column_default IS NULL AND column_name <> 'id'`,
      [table]
    )
  ).rows;
  const foreign = new Map(
    (
      await db.query<{ column_name: string; ref_table: string }>(
        `SELECT kcu.column_name, ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
         WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
        [table]
      )
    ).rows.map((r) => [r.column_name, r.ref_table])
  );
  const names: string[] = ["id", ...Object.keys(extra).map((k) => `"${k}"`)];
  const values: unknown[] = [id, ...Object.values(extra)];
  for (const c of columns.filter((col) => !(col.column_name in extra))) {
    names.push(`"${c.column_name}"`);
    const ref = foreign.get(c.column_name);
    if (c.column_name === "user_id") values.push(USER);
    else if (ref) values.push(await insertMinimal(db, ref, `${id}-${c.column_name}`));
    else values.push(TABLE_TEXT[`${table}.${c.column_name}`] ?? valueFor(c));
  }
  await db.query(
    `INSERT INTO "${table}" (${names.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`,
    values
  );
  return id;
}

function valueFor(c: ColumnInfo): unknown {
  if (c.data_type === "ARRAY") return "{}";
  switch (c.udt_name) {
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
      return 1;
    case "bool":
      return false;
    case "timestamp":
    case "timestamptz":
    case "date":
      return "2025-06-01T10:00:00Z";
    case "json":
    case "jsonb":
      return "{}";
    default:
      return KNOWN_TEXT[c.column_name] ?? "x";
  }
}

/** Text columns whose CHECK differs per table. */
const TABLE_TEXT: Record<string, string> = {
  "trip_expenses.kind": "other",
};

/** Text columns a CHECK holds to a vocabulary. */
const KNOWN_TEXT: Record<string, string> = {
  dep_time_semantics: "local",
  arr_time_semantics: "local",
  time_semantics: "local",
  status: "planned",
  kind: "trip",
  currency: "EUR",
};

type Row = Record<string, unknown>;

describe(`migration ${NEW} — documents get links`, () => {
  let admin: Client;
  let db: Client;
  let links: Row[];
  let docsBefore: Row[];
  let docsAfter: Row[];

  const documents = async () =>
    (await db.query<Row>(`SELECT * FROM documents ORDER BY id`)).rows.map((r) => ({ ...r }));

  beforeAll(async () => {
    admin = new Client({ connectionString: baseUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${DB}"`);
    db = new Client({ connectionString: withDatabase(baseUrl(), DB) });
    await db.connect();
    for (const name of earlierMigrations()) await db.query(migrationSql(name));

    await db.query(
      `INSERT INTO users (id, username, password_hash) VALUES ('${USER}', 'docs', 'x')`
    );
    const doc = (id: string, extra: string, values: string) =>
      db.query(
        `INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format,
           source, linked_at, unlinked_at${extra})
         VALUES ('${id}', '${USER}', '${id}.pdf', 'application/pdf', 1, '${id}', 'pdf', 'upload',
           ${values})`
      );
    for (const [column, table] of OWNER_COLUMNS) {
      // An expense belongs to exactly one trip or section (`trip_expenses_one_scope`).
      const extra =
        table === "trip_expenses"
          ? { trip_id: await insertMinimal(db, "trips", "e-expense-trip") }
          : {};
      const target = await insertMinimal(db, table, `e-${column}`, extra);
      await doc(`d-${column}`, `, ${column}`, `'2025-07-01 12:00:00', NULL, '${target}'`);
    }
    // A rental's categorised evidence, a receipt filed with a flight, an unfiled upload.
    await doc(
      "d-rental-cat",
      ", rental_booking_id, rental_category",
      `'2025-07-02 12:00:00', NULL, 'e-rental_booking_id', 'damage'`
    );
    await db.query(
      `INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format,
         source, kind, linked_at, flight_id)
       VALUES ('d-receipt', '${USER}', 'r.pdf', 'application/pdf', 1, 'r', 'pdf', 'receipt',
         'invoice', NULL, 'e-flight_id')`
    );
    await doc("d-unfiled", "", `NULL, '2025-07-03 12:00:00'`);

    docsBefore = await documents();
    await db.query(migrationSql(NEW));
    docsAfter = await documents();
    links = (await db.query<Row>(`SELECT * FROM document_links ORDER BY document_id`)).rows;
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin?.end();
  });

  it("makes every filed document one primary/legacy link to the entry it was filed with", () => {
    const filed = docsBefore.filter((d) => d.id !== "d-unfiled");
    expect(links).toHaveLength(filed.length);
    for (const d of filed) {
      const mine = links.filter((l) => l.document_id === d.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].role).toBe("primary");
      expect(mine[0].provenance).toBe("legacy");
      for (const [column] of OWNER_COLUMNS) expect(mine[0][column]).toBe(d[column]);
    }
  });

  it("carries a rental's category onto its link and dates a link by its filing", () => {
    const rental = links.find((l) => l.document_id === "d-rental-cat")!;
    expect(rental.rental_category).toBe("damage");
    expect(links.find((l) => l.document_id === "d-flight_id")!.rental_category).toBeNull();
    expect((rental.created_at as Date).toISOString()).toBe("2025-07-02T12:00:00.000Z");
    // A receipt filed by the hourly run never carried `linked_at`.
    expect(links.find((l) => l.document_id === "d-receipt")!.created_at).toBeInstanceOf(Date);
  });

  it("gives an unfiled document no link and changes no document row", () => {
    expect(links.some((l) => l.document_id === "d-unfiled")).toBe(false);
    expect(docsAfter).toEqual(docsBefore);
  });

  it("refuses a link with no target or two, and a second primary", async () => {
    const insert = (id: string, targets: string, values: string, role = "covers") =>
      db.query(
        `INSERT INTO document_links (id, document_id, role, provenance${targets})
         VALUES ('${id}', 'd-unfiled', '${role}', 'user'${values})`
      );
    await expect(insert("l-none", "", "")).rejects.toThrow(/single_target/);
    await expect(
      insert("l-two", ", flight_id, trip_id", ", 'e-flight_id', 'e-trip_id'")
    ).rejects.toThrow(/single_target/);
    await expect(
      db.query(
        `INSERT INTO document_links (id, document_id, role, provenance, cruise_id)
         VALUES ('l-p2', 'd-flight_id', 'primary', 'user', 'e-cruise_id')`
      )
    ).rejects.toThrow(/one_primary/);
  });

  it("deleting an entry keeps its document — unfiled, with the grace clock started", async () => {
    await db.query(`DELETE FROM flights WHERE id = 'e-flight_id'`);
    const [doc] = (await db.query<Row>(`SELECT * FROM documents WHERE id = 'd-flight_id'`)).rows;
    expect(doc).toBeDefined();
    expect(doc.flight_id).toBeNull();
    expect(doc.linked_at).toBeNull();
    expect(doc.unlinked_at).toBeInstanceOf(Date);
    expect(Date.now() - (doc.unlinked_at as Date).getTime()).toBeLessThan(10 * 60 * 1000);
    // The receipt filed with the same flight went the same way.
    const [receipt] = (await db.query<Row>(`SELECT * FROM documents WHERE id = 'd-receipt'`)).rows;
    expect(receipt.flight_id).toBeNull();
    expect(receipt.unlinked_at).toBeInstanceOf(Date);
  });

  it("deleting a rental clears its category with the link, past the CHECK", async () => {
    await db.query(`DELETE FROM rental_bookings WHERE id = 'e-rental_booking_id'`);
    const rows = (
      await db.query<Row>(
        `SELECT id, rental_booking_id, rental_category FROM documents
         WHERE id IN ('d-rental-cat', 'd-rental_booking_id') ORDER BY id`
      )
    ).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.rental_booking_id).toBeNull();
      expect(r.rental_category).toBeNull();
    }
  });

  it("a removed primary hands the role and the owner columns to the next link", async () => {
    await db.query(
      `INSERT INTO document_links (id, document_id, role, provenance, cruise_id, created_at)
       VALUES ('l-covers', 'd-trip_id', 'covers', 'user', 'e-cruise_id', now())`
    );
    await db.query(`DELETE FROM trips WHERE id = 'e-trip_id'`);
    const [doc] = (await db.query<Row>(`SELECT * FROM documents WHERE id = 'd-trip_id'`)).rows;
    expect(doc.trip_id).toBeNull();
    expect(doc.cruise_id).toBe("e-cruise_id");
    expect(doc.unlinked_at).toBeNull();
    const [link] = (await db.query<Row>(`SELECT role FROM document_links WHERE id = 'l-covers'`))
      .rows;
    expect(link.role).toBe("primary");
  });

  it("a document filed without a link is unfiled with a date when its entry goes", async () => {
    await db.query(
      `INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format,
         source, linked_at, cruise_id)
       VALUES ('d-nolink', '${USER}', 'n.pdf', 'application/pdf', 1, 'n', 'pdf', 'upload',
         now(), 'e-cruise_id')`
    );
    await db.query(`DELETE FROM cruises WHERE id = 'e-cruise_id'`);
    const [doc] = (await db.query<Row>(`SELECT * FROM documents WHERE id = 'd-nolink'`)).rows;
    expect(doc.cruise_id).toBeNull();
    expect(doc.linked_at).toBeNull();
    expect(doc.unlinked_at).toBeInstanceOf(Date);
  });

  it("deleting the account still removes every document and link", async () => {
    await db.query(`DELETE FROM users WHERE id = '${USER}'`);
    expect((await db.query(`SELECT 1 FROM documents`)).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM document_links`)).rowCount).toBe(0);
  });
});
