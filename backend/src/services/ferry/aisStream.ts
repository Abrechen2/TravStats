import WebSocket from "ws";
import { z } from "zod";
import { instanceTuning } from "../instanceTuning";

const ENDPOINT = "wss://stream.aisstream.io/v0/stream";
const WAIT_MS = 15000;
const CACHE_MS = 30000;
export interface VesselPosition {
  mmsi: string;
  vesselName: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  /** Server receipt time, deliberately not described as the vessel's observation time. */
  receivedAt: string;
  observedAt: string | null;
}
export type AisResult =
  | { status: "ok"; position: VesselPosition }
  | { status: "notConfigured" | "noSignal" | "unavailable" | "busy"; position: null };
const messageSchema = z.object({
  MessageType: z.literal("PositionReport"),
  MetaData: z.object({
    MMSI: z.number().int(),
    ShipName: z.string().max(200).optional(),
    Latitude: z.number().optional(),
    Longitude: z.number().optional(),
    time_utc: z.string().optional(),
  }),
  Message: z.object({
    PositionReport: z.object({
      UserID: z.number().int(),
      Valid: z.literal(true),
      Latitude: z.number().optional(),
      Longitude: z.number().optional(),
      Sog: z.number().optional(),
      Cog: z.number().optional(),
    }),
  }),
});
export function decodePosition(
  raw: unknown,
  mmsi: string,
  now = Date.now()
): VesselPosition | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const {
    MetaData: meta,
    Message: { PositionReport: p },
  } = parsed.data;
  if (String(meta.MMSI) !== mmsi || String(p.UserID) !== mmsi) return null;
  const lat = p.Latitude ?? meta.Latitude,
    lon = p.Longitude ?? meta.Longitude;
  if (
    lat === undefined ||
    lon === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null;
  const observed = meta.time_utc ? Date.parse(meta.time_utc) : NaN;
  return {
    mmsi,
    vesselName: meta.ShipName?.trim() || null,
    lat,
    lon,
    speedKnots: p.Sog !== undefined && p.Sog >= 0 && p.Sog < 102.3 ? p.Sog : null,
    courseDegrees: p.Cog !== undefined && p.Cog >= 0 && p.Cog < 360 ? p.Cog : null,
    receivedAt: new Date(now).toISOString(),
    observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null,
  };
}
export const aisConfigured = () => Boolean(instanceTuning().aisstreamApiKey?.trim());
const pending = new Map<string, Promise<AisResult>>();
const cache = new Map<string, { until: number; result: AisResult }>();
/** Sockets the whole instance holds open at once — the provider's key is shared. */
const MAX_SOCKETS = 2;
/**
 * Accounts with a socket open. One each: the cap above used to be shared by
 * everyone, so one account reading two vessels left all others "busy".
 */
const openFor = new Set<string>();
/** ShipStaticData sockets open now; they count against `MAX_SOCKETS` like a position read. */
let staticOpen = 0;
/**
 * On-demand snapshot. The vessel poller (`services/vessel/vesselPoller.ts`)
 * calls it for journeys in progress under its own account key, so it holds at
 * most one socket and leaves the other to the people reading a position.
 * At most one socket per user and `MAX_SOCKETS` in all; beyond that "busy".
 * A vessel someone is already reading joins that socket at no cost.
 */
export async function lookupVessel(mmsi: string, userId: string): Promise<AisResult> {
  if (!/^\d{9}$/.test(mmsi)) return { status: "unavailable", position: null };
  const key = instanceTuning().aisstreamApiKey?.trim();
  if (!key) return { status: "notConfigured", position: null };
  const cached = cache.get(mmsi);
  if (cached && cached.until > Date.now()) return cached.result;
  const same = pending.get(mmsi);
  if (same) return same;
  if (pending.size + staticOpen >= MAX_SOCKETS || openFor.has(userId)) {
    return { status: "busy", position: null };
  }
  openFor.add(userId);
  const request = new Promise<AisResult>((resolve) => {
    let finished = false;
    const socket = new WebSocket(ENDPOINT, {
      perMessageDeflate: true,
      handshakeTimeout: 8000,
      maxPayload: 65536,
    });
    const finish = (result: AisResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // No credential, raw frame, provider error or socket URL enters a log/response.
      socket.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "noSignal", position: null }), WAIT_MS);
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FiltersShipMMSI: [mmsi],
          FilterMessageTypes: ["PositionReport"],
        })
      )
    );
    socket.on("message", (bytes) => {
      try {
        const raw: unknown = JSON.parse(bytes.toString());
        if (typeof raw === "object" && raw !== null && ("error" in raw || "Error" in raw)) {
          finish({ status: "unavailable", position: null });
          return;
        }
        const position = decodePosition(raw, mmsi);
        if (position) finish({ status: "ok", position });
      } catch {
        /* Invalid/irrelevant frames never become a position. */
      }
    });
    socket.on("error", () => finish({ status: "unavailable", position: null }));
    socket.on("close", () => finish({ status: "noSignal", position: null }));
  }).catch(() => ({ status: "unavailable", position: null }) as AisResult);
  pending.set(mmsi, request);
  try {
    const result = await request;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(mmsi, { until: Date.now() + CACHE_MS, result });
    return result;
  } finally {
    pending.delete(mmsi);
    openFor.delete(userId);
  }
}

const STATIC_WAIT_MS = 20000;
/** A ShipStaticData frame's identity: MMSI, name and IMO as the ship transmits them. */
export interface AisStaticVessel {
  mmsi: string;
  name: string;
  imo: string | null;
}
const staticSchema = z.object({
  MessageType: z.literal("ShipStaticData"),
  Message: z.object({
    ShipStaticData: z.object({
      UserID: z.number().int(),
      Name: z.string().max(200),
      ImoNumber: z.number().int().optional(),
      Valid: z.literal(true),
    }),
  }),
});
export function decodeStatic(raw: unknown): AisStaticVessel | null {
  const parsed = staticSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data.Message.ShipStaticData;
  const mmsi = String(d.UserID);
  const name = d.Name.replace(/@+$/, "").trim();
  if (!/^\d{9}$/.test(mmsi) || name === "") return null;
  const imo = d.ImoNumber !== undefined && d.ImoNumber >= 1000000 ? String(d.ImoNumber) : null;
  return { mmsi, name, imo };
}
export type AisStaticResult =
  | { status: "ok"; vessels: AisStaticVessel[] }
  | { status: "notConfigured" | "unavailable" | "busy"; vessels: [] };
/**
 * Listen for ShipStaticData inside one box for up to 20 s and hand back every
 * vessel that identified itself — the resolver's last source (a name to an
 * MMSI while the ship is in terrestrial range). Same socket budget as a
 * position read; `stop` ends the wait early once the caller has its answer.
 */
export async function collectStaticData(
  box: { minLat: number; minLon: number; maxLat: number; maxLon: number },
  stop: (seen: AisStaticVessel[]) => boolean = () => false
): Promise<AisStaticResult> {
  const key = instanceTuning().aisstreamApiKey?.trim();
  if (!key) return { status: "notConfigured", vessels: [] };
  if (pending.size + staticOpen >= MAX_SOCKETS) return { status: "busy", vessels: [] };
  staticOpen += 1;
  try {
    return await new Promise<AisStaticResult>((resolve) => {
      const seen = new Map<string, AisStaticVessel>();
      let finished = false;
      // A socket the provider closed before a single frame is a failure, not "no ship here".
      let received = false;
      const socket = new WebSocket(ENDPOINT, {
        perMessageDeflate: true,
        handshakeTimeout: 8000,
        maxPayload: 65536,
      });
      const finish = (result: AisStaticResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.terminate();
        resolve(result);
      };
      const done = () => finish({ status: "ok", vessels: [...seen.values()] });
      const timer = setTimeout(done, STATIC_WAIT_MS);
      socket.on("open", () =>
        socket.send(
          JSON.stringify({
            APIKey: key,
            BoundingBoxes: [
              [
                [box.minLat, box.minLon],
                [box.maxLat, box.maxLon],
              ],
            ],
            FilterMessageTypes: ["ShipStaticData"],
          })
        )
      );
      socket.on("message", (bytes) => {
        try {
          const raw: unknown = JSON.parse(bytes.toString());
          if (typeof raw === "object" && raw !== null && ("error" in raw || "Error" in raw)) {
            finish({ status: "unavailable", vessels: [] });
            return;
          }
          received = true;
          const vessel = decodeStatic(raw);
          if (vessel && seen.size < 5000) seen.set(vessel.mmsi, vessel);
          if (vessel && stop([...seen.values()])) done();
        } catch {
          /* Invalid/irrelevant frames never become a vessel. */
        }
      });
      socket.on("error", () => finish({ status: "unavailable", vessels: [] }));
      socket.on("close", () =>
        received ? done() : finish({ status: "unavailable", vessels: [] })
      );
    });
  } catch {
    return { status: "unavailable", vessels: [] };
  } finally {
    staticOpen -= 1;
  }
}
