/**
 * Dev-only seed: persist the operator's flight-API keys from `.env`
 * into the Admin-Settings table as encrypted **global** keys, so the
 * Dev server's lookup cascade (User → Admin Global → ENV) has them
 * available for every dev user out of the box and the Settings UI
 * shows them as "configured globally".
 *
 * Reads from `process.env` (whichever .env was loaded). Empty values
 * are skipped — running this without a key set leaves the existing
 * row untouched. Idempotent — safe to re-run.
 *
 *   AIRLABS_API_KEY=... AVIATIONSTACK_API_KEY=... \
 *   AERODATABOX_API_KEY=... OPENSKY_CLIENT_ID=... \
 *   OPENSKY_CLIENT_SECRET=... \
 *   DATABASE_URL="postgresql://..." \
 *   npm run seed:dev-admin-keys
 *
 * NEVER run against a production DB — overwrites global key columns.
 */
import "dotenv/config";
import { prisma } from "./db";
import { encryptApiKey } from "./utils/encryption";

interface KeyMapping {
  envVar: string;
  column:
    | "globalAirlabsApiKey"
    | "globalAviationstackApiKey"
    | "globalAerodataboxApiKey"
    | "globalOpenskyClientId"
    | "globalOpenskyClientSecret";
  label: string;
}

const MAPPINGS: KeyMapping[] = [
  { envVar: "AIRLABS_API_KEY", column: "globalAirlabsApiKey", label: "AirLabs" },
  { envVar: "AVIATIONSTACK_API_KEY", column: "globalAviationstackApiKey", label: "Aviationstack" },
  { envVar: "AERODATABOX_API_KEY", column: "globalAerodataboxApiKey", label: "AeroDataBox" },
  { envVar: "OPENSKY_CLIENT_ID", column: "globalOpenskyClientId", label: "OpenSky Client ID" },
  { envVar: "OPENSKY_CLIENT_SECRET", column: "globalOpenskyClientSecret", label: "OpenSky Client Secret" },
];

async function seedDevAdminKeys(): Promise<void> {
  console.log("🔑 Seeding global flight-API keys into AdminSettings...");

  const updateData: Partial<Record<KeyMapping["column"], string | null>> = {};
  const summary: string[] = [];

  for (const { envVar, column, label } of MAPPINGS) {
    const value = process.env[envVar]?.trim();
    if (!value) {
      summary.push(`   ⏭  ${label.padEnd(24)} (no ${envVar} in env, skipped)`);
      continue;
    }
    updateData[column] = encryptApiKey(value);
    const masked = value.length > 8 ? `${value.slice(0, 4)}****${value.slice(-4)}` : "****";
    summary.push(`   ✅ ${label.padEnd(24)} ${masked}`);
  }

  if (Object.keys(updateData).length === 0) {
    console.log("   No keys found in env — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const existing = await prisma.adminSettings.findFirst();

  if (existing) {
    await prisma.adminSettings.update({
      where: { id: existing.id },
      data: updateData,
    });
  } else {
    await prisma.adminSettings.create({
      data: {
        allowUserApiKeys: true,
        defaultVisionParser: "auto",
        defaultTextParser: "auto",
        allowUserFlightApiKeys: true,
        ...updateData,
      },
    });
  }

  console.log("");
  for (const line of summary) console.log(line);
  console.log("");
  console.log("✅ Global API keys persisted (encrypted) to admin_settings.");
  await prisma.$disconnect();
}

seedDevAdminKeys().catch(async (err) => {
  console.error("❌ Failed to seed admin keys:", err);
  await prisma.$disconnect();
  process.exit(1);
});
