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
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { seedDemoUser } from "./seedDemoUser";
import { loadPools, seedCruises } from "./seedDemoAccount";

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
    // Give the dev admin a home airport (Munich, matching the demo flight hub)
    // so the fly & cruise import pre-fills the home-side flight airport.
    const settingsData = {
      homeAirportHistory: [{ iata: "MUC", fromDate: "2015-01-01", toDate: null }],
    } as unknown as Prisma.InputJsonValue;
    await prisma.userSettings.upsert({
      where: { userId: admin.id },
      create: {
        userId: admin.id,
        enabledDomains: ["flight", "cruise"],
        data: settingsData,
      },
      update: { enabledDomains: ["flight", "cruise"], data: settingsData },
    });
    console.log("   Multi-domain enabled: flight, cruise · home airport: MUC");

    // Demo cruises — seedDemoUser ships only flights + trips, so the dev
    // admin's Kreuzfahrten tab would otherwise be empty. Reuse the cruise
    // templates from seedDemoAccount. Idempotent: clear this user's cruises
    // first (CruiseStop cascades on cruise delete).
    const { ships, ports } = await loadPools();
    await prisma.cruise.deleteMany({ where: { userId: admin.id } });
    await seedCruises(admin.id, ships, ports);

    // Ollama parser config (cruise/flight booking import). Read from env so
    // the machine-specific URL stays out of the repo (see CLAUDE.local.md).
    // /parser-capabilities and the admin parser-settings UI read admin_settings,
    // not the env vars — so persist them here when provided.
    const ollamaUrl = process.env.OLLAMA_URL;
    const ollamaModel = process.env.OLLAMA_MODEL;
    if (ollamaUrl && ollamaModel) {
      const existing = await prisma.adminSettings.findFirst();
      if (existing) {
        await prisma.adminSettings.update({
          where: { id: existing.id },
          data: { ollamaUrl, ollamaModel },
        });
      } else {
        await prisma.adminSettings.create({ data: { ollamaUrl, ollamaModel } });
      }
      console.log(`   Ollama configured: ${ollamaModel} @ ${ollamaUrl}`);
    }
  }
  await prisma.$disconnect();
})();
