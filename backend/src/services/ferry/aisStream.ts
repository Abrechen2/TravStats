import WebSocket from "ws";
import { z } from "zod";

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
export const aisConfigured = () => Boolean(process.env.AISSTREAM_API_KEY?.trim());
const pending = new Map<string, Promise<AisResult>>();
const cache = new Map<string, { until: number; result: AisResult }>();
/** Sockets the whole instance holds open at once — the provider's key is shared. */
const MAX_SOCKETS = 2;
/**
 * Accounts with a socket open. One each: the cap above used to be shared by
 * everyone, so one account reading two vessels left all others "busy".
 */
const openFor = new Set<string>();
/**
 * On-demand snapshot, not a persistent voyage tracker, no background polling.
 * At most one socket per user and `MAX_SOCKETS` in all; beyond that "busy".
 * A vessel someone is already reading joins that socket at no cost.
 */
export async function lookupVessel(mmsi: string, userId: string): Promise<AisResult> {
  if (!/^\d{9}$/.test(mmsi)) return { status: "unavailable", position: null };
  const key = process.env.AISSTREAM_API_KEY?.trim();
  if (!key) return { status: "notConfigured", position: null };
  const cached = cache.get(mmsi);
  if (cached && cached.until > Date.now()) return cached.result;
  const same = pending.get(mmsi);
  if (same) return same;
  if (pending.size >= MAX_SOCKETS || openFor.has(userId)) {
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
