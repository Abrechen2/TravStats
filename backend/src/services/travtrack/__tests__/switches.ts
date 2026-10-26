import { prisma } from "../../../db";
import { getInstanceSettings, updateInstanceSettings } from "../../instanceSettingsService";

/**
 * The two admin switches TravTrack depends on, set for a test and put back
 * afterwards. Not a test file (no `.test.ts` suffix): imported by the suites.
 */
export interface TravTrackSwitches {
  set(switches: { beta: boolean; config: boolean | null }): Promise<void>;
  restore(): Promise<void>;
}

export function travTrackSwitches(): TravTrackSwitches {
  let betaBefore: boolean | null = null;
  let configBefore: { enabled: boolean } | null | undefined;
  const envBefore = process.env.TRAVTRACK_ENABLED;
  return {
    async set({ beta, config }) {
      if (betaBefore === null) betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
      if (configBefore === undefined) {
        configBefore = await prisma.travTrackConfig.findUnique({
          where: { id: "default" },
          select: { enabled: true },
        });
      }
      await updateInstanceSettings({ betaFeaturesEnabled: beta });
      if (config === null) {
        await prisma.travTrackConfig.deleteMany({ where: { id: "default" } });
      } else {
        await prisma.travTrackConfig.upsert({
          where: { id: "default" },
          create: { id: "default", enabled: config },
          update: { enabled: config },
        });
      }
    },
    async restore() {
      if (betaBefore !== null) await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
      if (configBefore === null) {
        await prisma.travTrackConfig.deleteMany({ where: { id: "default" } });
      } else if (configBefore) {
        await prisma.travTrackConfig.update({
          where: { id: "default" },
          data: { enabled: configBefore.enabled },
        });
      }
      if (envBefore === undefined) delete process.env.TRAVTRACK_ENABLED;
      else process.env.TRAVTRACK_ENABLED = envBefore;
    },
  };
}
