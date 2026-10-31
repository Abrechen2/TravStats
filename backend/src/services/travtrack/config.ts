import { prisma, type DbTransaction } from "../../db";

/**
 * TravTrack's instance switch (TravTrack plan, task T1): one `travtrack_config`
 * row, `default`, written by the admin. Without the row the `TRAVTRACK_ENABLED`
 * environment variable decides, so an operator can pre-configure an instance
 * before anybody opens Admin → Instanz. Once the row exists it wins, whatever
 * the environment says — the admin's last word is the switch.
 *
 * The switch alone turns nothing on: the beta switch has to be on as well
 * (`availability.ts`).
 */

export interface TravTrackConfig {
  enabled: boolean;
}

type ConfigReader = Pick<DbTransaction, "travTrackConfig">;

/** Read through `db` — a transaction's, when the answer must hold for its writes. */
export async function travTrackConfig(db: ConfigReader = prisma): Promise<TravTrackConfig> {
  const row = await db.travTrackConfig.findUnique({
    where: { id: "default" },
    select: { enabled: true },
  });
  return row ? { enabled: row.enabled } : { enabled: false };
}

export async function setTravTrackConfig(config: TravTrackConfig): Promise<TravTrackConfig> {
  const row = await prisma.travTrackConfig.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: config.enabled },
    update: { enabled: config.enabled },
    select: { enabled: true },
  });
  return { enabled: row.enabled };
}
