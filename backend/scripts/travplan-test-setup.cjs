const { randomBytes } = require("node:crypto");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^\/travplan_[a-z0-9_]+$/.test(url.pathname)
)
  throw Error(
    "Set DATABASE_URL to an isolated loopback travplan_* test database. Existing instances are refused."
  );
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(48).toString("base64url");
const directory = mkdtempSync(join(tmpdir(), "travplan-tests-"));
process.env.SECRETS_DIR = join(directory, "secrets");
process.env.LOG_DIR = join(directory, "logs");
process.env.BACKUP_PATH = join(directory, "backups");
