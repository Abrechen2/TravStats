import { prisma } from "../../db";
import { buildUserDawarichConnection } from "../dawarich/dawarichResolver";
import { dawarichProvider } from "./dawarichProvider";
import { getLocationProvider } from "./provider";
import { travtrackProvider } from "./travtrackProvider";
import type { LocationProvider } from "./types";

/**
 * The provider an account's entries read from (TravTrack plan T4): the chosen
 * one, and only while it works. `travtrack` + `ok` already requires the
 * instance to be on (derivations are the `on` tier, review focus 14);
 * `dawarich` + `ok` reads through the user's OWN connection — never the
 * admin-global or ENV one, whose movements are not this account's. Anything
 * else reads nothing (null).
 *
 * An explicit pull ("aus Dawarich holen" on a tour or cruise) does not come
 * through here: it reads the connection it was asked to, whatever the provider.
 */
export async function providerFor(userId: string): Promise<LocationProvider | null> {
  const state = await getLocationProvider(userId);
  if (state.status !== "ok") return null;
  if (state.kind === "travtrack") return travtrackProvider(userId);
  if (state.kind !== "dawarich") return null;
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const connection = buildUserDawarichConnection(row?.dawarichBaseUrl, row?.dawarichApiKey);
  return connection ? dawarichProvider(connection) : null;
}
