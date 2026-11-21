import archiver from "archiver";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";
import yauzl from "yauzl";

/** Test plumbing for the account archive: a second database and ZIP surgery. */

const BACKEND = path.join(__dirname, "../../../..");
const PRISMA_CLI = require.resolve("prisma/build/index.js", { paths: [BACKEND] });

export const BASE_URL = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");

export function urlFor(database: string): string {
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${database}`;
  url.search = "";
  return url.toString();
}

export async function withClient<T>(
  database: string,
  work: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const baseName = () => decodeURIComponent(BASE_URL.pathname.slice(1));

export async function recreateDatabase(name: string): Promise<void> {
  await withClient(baseName(), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}"`);
  });
}

export async function dropDatabase(name: string): Promise<void> {
  await withClient(baseName(), (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** `prisma migrate deploy` into `database`, the way a new server starts. */
export function migrate(database: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "az-migrate-"));
  try {
    fs.cpSync(path.join(BACKEND, "prisma/migrations"), path.join(dir, "migrations"), {
      recursive: true,
    });
    fs.copyFileSync(path.join(BACKEND, "prisma/schema.prisma"), path.join(dir, "schema.prisma"));
    fs.writeFileSync(
      path.join(dir, "prisma.config.ts"),
      `export default { schema: "schema.prisma", migrations: { path: "migrations" }, ` +
        `datasource: { url: ${JSON.stringify(urlFor(database))} } };\n`
    );
    const run = spawnSync(
      process.execPath,
      [PRISMA_CLI, "migrate", "deploy", "--config", path.join(dir, "prisma.config.ts")],
      {
        cwd: dir,
        encoding: "utf-8",
      }
    );
    if (run.status !== 0)
      throw new Error(`migrate deploy of ${database} failed: ${run.stdout}\n${run.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Every entry of a ZIP, read into memory (test archives are small). */
export async function readZip(file: string): Promise<Map<string, Buffer>> {
  const zip = await yauzl.openPromise(file, { lazyEntries: true });
  const out = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          out.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
        stream.on("error", reject);
      });
    });
    zip.on("end", resolve);
    zip.on("error", reject);
    zip.readEntry();
  });
  zip.close();
  return out;
}

export async function writeZip(file: string, entries: Map<string, Buffer>): Promise<void> {
  const out = fs.createWriteStream(file);
  const archive = archiver("zip");
  const done = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(out);
  for (const [name, bytes] of entries) archive.append(bytes, { name });
  await archive.finalize();
  await done;
}

export function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .sort();
}
