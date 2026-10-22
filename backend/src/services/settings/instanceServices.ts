import { z } from "zod";
import { getInstanceSettings } from "../instanceSettingsService";

/**
 * Whether each keyless instance service is on, as an ordinary account may
 * know it (forgejo#321). The shape is the whole contract: three booleans and
 * nothing else, so a field added to the instance settings can never ride
 * along to every account by accident.
 */
export const instanceServicesSchema = z
  .object({
    transitous: z.boolean().describe("The rail lookup may ask Transitous"),
    dbRest: z.boolean().describe("The rail lookup may ask db-rest"),
    openRailRouting: z
      .boolean()
      .describe("A self-hosted OpenRailRouting draws rail lines along the tracks"),
  })
  .strict();

export type InstanceServicesView = z.infer<typeof instanceServicesSchema>;

export async function instanceServicesView(): Promise<InstanceServicesView> {
  const settings = await getInstanceSettings();
  return instanceServicesSchema.parse({
    transitous: settings.railTransitousEnabled,
    dbRest: settings.railDbRestEnabled,
    // The router's own test (`railRoutingBaseUrl`): a URL set means on. The
    // URL itself is the admin's and stays here.
    openRailRouting: settings.railRoutingUrl !== null,
  });
}
