/**
 * Dev-only seed: ensure `admin:admin123` exists as the standard admin
 * account on a developer's local DB and load the same demo dataset that
 * `seedDemoUser` ships into that admin's account.
 *
 * Idempotent — safe to re-run. Existing admin password and flag get reset
 * on each run so a forgotten dev password is always recoverable.
 *
 *   npm run seed:dev-admin
 *
 * NEVER run against a production DB. The DATABASE_URL gate in CLAUDE.local.md
 * (localhost:5433/flights_dev) is the operator's responsibility.
 */
import { prisma } from "./db";
import { seedDemoUser } from "./seedDemoUser";

void (async () => {
  await seedDemoUser({
    username: "admin",
    password: "admin123",
    isAdmin: true,
    resetCredentials: true,
  });

  // Ensure the dev admin has the multi-domain experience enabled by
  // default. Without this the UserSettings row created on first login
  // defaults to ["flight"] only and the cruise/POI tabs stay hidden —
  // breaks the multi-domain dashboard E2E suite and forces the operator
  // to flip the toggle through the UI every time the dev DB is wiped.
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (admin) {
    await prisma.userSettings.upsert({
      where: { userId: admin.id },
      create: {
        userId: admin.id,
        enabledDomains: ["flight", "cruise"],
        data: {},
      },
      update: { enabledDomains: ["flight", "cruise"] },
    });
    console.log("   Multi-domain enabled: flight, cruise");
  }
  await prisma.$disconnect();
})();
