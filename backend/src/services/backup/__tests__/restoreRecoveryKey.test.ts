import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "pg";
import request from "supertest";

/**
 * A restore onto a server with ANOTHER instance key, handed the recovery key of
 * the server that wrote the archive (owner request 2026-11-24).
 *
 * Before: the restore was refused with RESTORE_ENCRYPTION_KEY_MISMATCH, or —
 * acknowledged — completed with every stored API key, SMTP password and WebDAV
 * password unreadable. Now the pasted key is checked against the archive's
 * fingerprint, installed before the dump replays, and the credentials read
 * again afterwards. End to end: a real pg_dump from a database under key A, a
 * real psql replay into a second database whose server holds key B.
 *
 * Needs `pg_dump` and `psql` on PATH, like `restoreRoundTrip.test.ts`; skipped
 * without them on a developer machine, and FAILS in CI.
 */

const TOOLS_MISSING = ["pg_dump", "psql"].filter(
  (tool) => spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0
);
if (TOOLS_MISSING.length > 0 && process.env.CI) {
  throw new Error(
    `restoreRecoveryKey: ${TOOLS_MISSING.join(" and ")} not on PATH. CI must run this suite, not skip it.`
  );
}
const describeWithTools = TOOLS_MISSING.length === 0 ? describe : describe.skip;

const BACKEND = path.join(__dirname, "../../../..");
const MIGRATIONS = path.join(BACKEND, "prisma/migrations");
const PRISMA_CLI = require.resolve("prisma/build/index.js", { paths: [BACKEND] });

const BASE_URL = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
const BASE_NAME = decodeURIComponent(BASE_URL.pathname.slice(1));
const SOURCE_DB = `${BASE_NAME}_rk_src`;
const TARGET_DB = `${BASE_NAME}_rk_dst`;

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_C = "c3".repeat(32);
const ADMIN_PASSWORD = "restore-admin-pw-1";

function urlFor(database: string): string {
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${encodeURIComponent(database)}`;
  url.search = "?connection_limit=5";
  return url.toString();
}

async function admin(sql: string): Promise<void> {
  const url = new URL(urlFor("postgres"));
  url.search = "";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name: string): Promise<void> {
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${name}"`);
}

function migrate(database: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rk-migrate-"));
  try {
    fs.cpSync(MIGRATIONS, path.join(dir, "migrations"), { recursive: true });
    fs.copyFileSync(path.join(BACKEND, "prisma/schema.prisma"), path.join(dir, "schema.prisma"));
    fs.writeFileSync(
      path.join(dir, "prisma.config.ts"),
      `export default { schema: "schema.prisma", migrations: { path: "migrations" }, ` +
        `datasource: { url: ${JSON.stringify(urlFor(database))} } };\n`
    );
    const run = spawnSync(
      process.execPath,
      [PRISMA_CLI, "migrate", "deploy", "--config", path.join(dir, "prisma.config.ts")],
      { cwd: dir, encoding: "utf-8" }
    );
    if (run.status !== 0) throw new Error(`migrate deploy of ${database} failed: ${run.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Modules = {
  service: typeof import("../../backupService");
  prisma: typeof import("../../../db").prisma;
  encryption: typeof import("../../../utils/encryption");
  app: typeof import("../../../index").default;
  jobs: typeof import("../../jobs/jobRegistry");
  jwt: typeof import("../../../utils/jwt");
  password: typeof import("../../../utils/password");
  logger: typeof import("../../../utils/logger");
};

describeWithTools("a restore handed the archive's recovery key", () => {
  jest.setTimeout(300_000);

  const originalEnv = { ...process.env };
  let workDir: string;
  let secretsDir: string;
  let keyFile: string;
  let archivePath: string;
  let target: Modules;
  let backupId: string;
  let adminId: string;
  let cookie: string;

  /** A fresh module graph against `database`, whose key file holds `keyHex`. */
  async function boot(database: string, keyHex: string): Promise<Modules> {
    fs.writeFileSync(keyFile, keyHex, { mode: 0o600 });
    delete process.env.ENCRYPTION_KEY;
    process.env.DATABASE_URL = urlFor(database);
    jest.resetModules();
    return {
      service: await import("../../backupService"),
      prisma: (await import("../../../db")).prisma,
      encryption: await import("../../../utils/encryption"),
      app: (await import("../../../index")).default,
      jobs: await import("../../jobs/jobRegistry"),
      jwt: await import("../../../utils/jwt"),
      password: await import("../../../utils/password"),
      logger: await import("../../../utils/logger"),
    };
  }

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-recovery-key-"));
    secretsDir = path.join(workDir, "secrets");
    fs.mkdirSync(secretsDir);
    keyFile = path.join(secretsDir, "encryption.key");
    process.env.SECRETS_DIR = secretsDir;
    process.env.BACKUP_PATH = path.join(workDir, "backups");
    delete process.env.DOCKER;

    // Server A: a stored WebDAV password, encrypted under key A, then a backup.
    await recreateDatabase(SOURCE_DB);
    migrate(SOURCE_DB);
    const source = await boot(SOURCE_DB, KEY_A);
    await source.prisma.adminSettings.create({
      data: {
        webdavUrl: "https://dav.example.test/",
        webdavUsername: "dav",
        webdavPasswordEncrypted: source.encryption.encryptApiKey("dav-secret"),
      },
    });
    const id = await source.service.createBackup({ type: "partial" });
    archivePath = (await source.prisma.backup.findUniqueOrThrow({ where: { id } }))
      .backupPath as string;
    await source.prisma.$disconnect();

    // Server B: its own key, its own federation key (identity a restore keeps).
    await recreateDatabase(TARGET_DB);
    migrate(TARGET_DB);
    target = await boot(TARGET_DB, KEY_B);
    await target.prisma.adminSettings.create({
      data: { federationPrivateKey: target.encryption.encryptApiKey("server-b-federation-pem") },
    });
    adminId = (
      await target.prisma.user.create({
        data: {
          username: "rk-restore-admin",
          passwordHash: await target.password.hashPassword(ADMIN_PASSWORD),
          isAdmin: true,
          isActive: true,
        },
      })
    ).id;
    cookie = `auth_token=${target.jwt.generateToken(adminId)}`;
    backupId = (
      await target.prisma.backup.create({
        data: { status: "completed", backupPath: archivePath, completedAt: new Date() },
      })
    ).id;
  });

  afterAll(async () => {
    await target?.prisma.$disconnect();
    process.env = originalEnv;
    await admin(`DROP DATABASE IF EXISTS "${SOURCE_DB}" WITH (FORCE)`);
    await admin(`DROP DATABASE IF EXISTS "${TARGET_DB}" WITH (FORCE)`);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const restore = (recoveryKey?: string) =>
    target.service.restoreBackup(backupId, {
      scope: "database",
      createBackupBefore: false,
      ...(recoveryKey !== undefined ? { recoveryKey } : {}),
    });

  it("without a key the mismatch is still refused, as before", async () => {
    await expect(restore()).rejects.toMatchObject({ code: "RESTORE_ENCRYPTION_KEY_MISMATCH" });
  });

  it("a key that did not write the archive is refused and changes nothing", async () => {
    await expect(restore(KEY_C)).rejects.toMatchObject({ code: "RESTORE_RECOVERY_KEY_WRONG" });
    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_B);
    const row = await target.prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(row.webdavUrl).toBeNull();
  });

  const post = (body: object) =>
    request(target.app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", cookie)
      .send({ scope: "database", createBackupBefore: false, ...body });

  async function settled(jobId: string) {
    for (let i = 0; i < 600; i += 1) {
      const job = target.jobs.getJob(jobId, adminId);
      if (job && job.status !== "running") return job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("restore job did not finish");
  }

  it("a pasted key without a fresh re-authentication is refused and changes nothing", async () => {
    const res = await post({ recoveryKey: KEY_A });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RECOVERY_KEY_REAUTH_REQUIRED");
    const wrong = await post({ recoveryKey: KEY_A, password: "not-it" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("REAUTH_PASSWORD_INCORRECT");
    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_B);
  });

  it("re-authenticated but with a key that did not write the archive: refused, key unchanged", async () => {
    const res = await post({ recoveryKey: KEY_C, password: ADMIN_PASSWORD });
    expect(res.status).toBe(202);
    const job = await settled(res.body.data.jobId);
    expect(job.error?.code).toBe("RESTORE_RECOVERY_KEY_WRONG");
    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_B);
  });

  it("archive from key A, server with key B, re-auth + pasted key A: replaced, logged, credentials read", async () => {
    const audit: string[] = [];
    const warn = jest
      .spyOn(target.logger.securityLogger, "warn")
      .mockImplementation(((obj: unknown) => void audit.push(JSON.stringify(obj))) as never);
    const grouped = KEY_A.toUpperCase().match(/.{4}/g)!.join(" ");
    // Three restores an hour per account; the refusals above spent them.
    const limits = await import("../../../middleware/rateLimit");
    await limits.backupRestoreLimiter.resetKey(`user:${adminId}`);
    try {
      const res = await post({ recoveryKey: grouped, password: ADMIN_PASSWORD });
      expect(res.status).toBe(202);
      const job = await settled(res.body.data.jobId);
      expect(job.error).toBeNull();
    } finally {
      warn.mockRestore();
    }

    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_A);
    // The key in force before is kept beside it: it decrypts the safety backup.
    const kept = fs.readdirSync(secretsDir).filter((f) => f.includes(".before-restore-"));
    expect(kept.map((f) => fs.readFileSync(path.join(secretsDir, f), "utf-8"))).toEqual([KEY_B]);
    const line = audit.find((l) => l.includes("encryption_key_replaced_via_restore"));
    expect(line).toBeDefined();
    expect(line).toContain(adminId);
    expect(audit.join("\n").toLowerCase()).not.toContain(KEY_A);

    const row = await target.prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(row.webdavUrl).toBe("https://dav.example.test/");
    expect(target.encryption.decryptApiKey(row.webdavPasswordEncrypted)).toBe("dav-secret");
    // Server B's own identity survived the restore AND the key change.
    expect(target.encryption.decryptApiKey(row.federationPrivateKey)).toBe(
      "server-b-federation-pem"
    );
  });
});
