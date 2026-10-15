/** Serve the full application without startup schedulers against an explicit disposable database. */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^\/travplan_[a-z0-9_]+$/.test(url.pathname)
)
  throw Error(
    "An explicit loopback travplan_* database is required. Existing instances are refused."
  );
process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.JWT_SECRET ||= randomBytes(48).toString("base64url");
process.env.BACKUP_PATH ||= "/tmp/travplan-preview/backups";
process.env.SECRETS_DIR ||= "/tmp/travplan-preview/secrets";
process.env.LOG_DIR ||= "/tmp/travplan-preview/logs";
mkdirSync(process.env.BACKUP_PATH, { recursive: true });
(async () => {
  const { app } = await import("../src/index");
  const { prisma } = await import("../src/db");
  // These writes are limited to the explicit disposable database above.
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  app.listen(Number(process.env.PORT || 3540), process.env.HOST || "127.0.0.1", () =>
    console.log("Disposable TravPlan preview is ready")
  );
})().catch((error) => {
  console.error(error instanceof Error ? error.name : "Preview startup failed");
  process.exitCode = 1;
});
