/**
 * Remote guests on a plan (forgejo#404, spec 2026-10-17 §6.5). Bare response family.
 *
 * A separate router with a separate door (`authenticateGuest`): every route below the join
 * endpoints acts as `req.guest`, one plan, never as a user. A path whose `:planId` is not the
 * credential's plan answers the 404 of a plan that does not exist. Owner-only acts have no route
 * here at all (no delete, no member management, no AI proposals), and the mutation endpoint
 * refuses them with the same `PLAN_OWNER_ONLY` a local co-planner meets.
 */
import { Router, type NextFunction, type Response } from "express";
import fs from "node:fs";
import { z } from "zod";
import {
  assertPathPlan,
  authenticateGuest,
  guestLimiter,
  joinLimiter,
  type GuestRequest,
} from "../middleware/guestAuth";
import { planDocumentUpload } from "../middleware/planDocumentUpload";
import { AppError } from "../middleware/errorHandler";
import { getCookieSecure } from "../utils/session";
import { assertTravPlanOffered } from "../services/travplan/availability";
import { assertEnabled, findReceipt, readPlan, writePlan } from "../services/travplan/store";
import { writeSchema } from "../services/travplan/schema";
import { parseState } from "../services/travplan/upgrade";
import { collab, markNoticesRead } from "../services/travplan/members";
import { refreshForecast } from "../services/travplan/weather";
import { refreshStationClimate } from "../services/travplan/climate";
import { packingSuggestions } from "../services/travplan/rules";
import { findLocations } from "../services/travplan/locations";
import { searchPlaces } from "../services/travplan/placeSearch";
import { routeStage } from "../services/travplan/stageRouting";
import { matchPlaceholders } from "../services/travplan/placeholders";
import { bookingSchema } from "../services/travplan/schema";
import { collectTrip } from "../services/trip/exchange/collect";
import {
  buildManifest,
  presentFiles,
  writeTripArchive,
} from "../services/trip/exchange/writeArchive";
import { TRIP_FILE_EXTENSION } from "../services/trip/exchange/format";
import { fileSlug } from "./trips/tripExchange";
import logger from "../utils/logger";
import { accessiblePlan, planAccess, type GuestActor } from "../services/travplan/access";
import {
  listPlanDocuments,
  readPlanDocument,
  uploadPlanDocument,
} from "../services/travplan/planDocuments";
import { documentPath } from "../services/documents/documentStore";
import {
  JOIN_COOKIE,
  JOIN_MINUTES,
  completeJoin,
  startJoin,
} from "../services/travplan/guests/invites";
import {
  GUEST_COOKIE,
  endCredential,
  endGuestAccess,
  issueCredential,
} from "../services/travplan/guests/sessions";

const router = Router();
const uuid = z.string().uuid();
const guestPaths = { httpOnly: true, sameSite: "lax" as const, path: "/api/v1/guest" };

const route =
  (fn: (req: GuestRequest, res: Response) => Promise<void>) =>
  (req: GuestRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const actorOf = (req: GuestRequest): GuestActor => ({
  guest: { memberId: req.guest!.memberId, planId: req.guest!.planId },
});
const trip = (req: GuestRequest) => req.guest!.tripId;

// ---- Joining: no credential yet. The invitation secret and the vouch are the proof. ----------
router.post(
  "/join/start",
  joinLimiter,
  route(async (req, res) => {
    await assertTravPlanOffered();
    await assertEnabled();
    const body = z
      .object({ inviteId: uuid, secret: z.string().min(20).max(200) })
      .strict()
      .parse(req.body);
    const started = await startJoin(body);
    res.cookie(JOIN_COOKIE, started.browserToken, {
      ...guestPaths,
      path: "/api/v1/guest/join",
      secure: getCookieSecure(req),
      maxAge: JOIN_MINUTES * 60_000,
    });
    res.json({
      vouchUrl: started.vouchUrl,
      guestOrigin: started.guestOrigin,
      host: started.host,
    });
  })
);

router.post(
  "/join/complete",
  joinLimiter,
  route(async (req, res) => {
    await assertTravPlanOffered();
    await assertEnabled();
    const body = z
      .object({ vouch: z.string().min(20).max(2000) })
      .strict()
      .parse(req.body);
    const joined = await completeJoin({
      vouch: body.vouch,
      browserToken: req.cookies?.[JOIN_COOKIE] as string | undefined,
    });
    res.clearCookie(JOIN_COOKIE, { ...guestPaths, path: "/api/v1/guest/join" });
    res.cookie(GUEST_COOKIE, joined.token, {
      ...guestPaths,
      secure: getCookieSecure(req),
      expires: joined.expiresAt,
    });
    res.status(201).json({
      planId: joined.planId,
      tripId: joined.tripId,
      expiresAt: joined.expiresAt.toISOString(),
    });
  })
);

// ---- Everything below is one guest on one plan. ----------------------------------------------
router.use(authenticateGuest, guestLimiter);

router.get(
  "/session",
  route(async (req, res) => {
    const g = req.guest!;
    const access = await planAccess(actorOf(req), g.tripId);
    res.json({
      planId: g.planId,
      tripId: g.tripId,
      planName: access.row.trip.name,
      memberId: g.memberId,
      displayName: g.displayName,
      origin: g.origin,
      credential: g.kind,
    });
  })
);

router.post(
  "/logout",
  route(async (req, res) => {
    await endCredential(req.guest!.credentialId);
    res.clearCookie(GUEST_COOKIE, guestPaths);
    res.json({ loggedOut: true });
  })
);

router.post(
  "/leave",
  route(async (req, res) => {
    await endGuestAccess([req.guest!.memberId], "left");
    res.clearCookie(GUEST_COOKIE, guestPaths);
    res.json({ left: true });
  })
);

router.use("/plans/:planId", assertPathPlan());

// A phone token for this one plan; only a browser session mints one, never another phone token.
router.post(
  "/plans/:planId/pat",
  route(async (req, res) => {
    if (req.guest!.kind !== "session")
      throw new AppError(
        "Only a browser session may mint a phone token",
        403,
        "PLAN_GUEST_REQUIRED"
      );
    const pat = await issueCredential({
      memberId: req.guest!.memberId,
      planId: req.guest!.planId,
      kind: "pat",
      origin: req.guest!.origin,
    });
    res.status(201).json({ token: pat.token, expiresAt: pat.expiresAt.toISOString() });
  })
);

router.get(
  "/plans/:planId",
  route(async (req, res) => {
    const result = await readPlan(actorOf(req), trip(req));
    res.setHeader("ETag", '"' + result.revision + "-" + (result.self?.memberId ?? "") + '"');
    res.json(result);
  })
);

router.post(
  "/plans/:planId/mutations",
  route(async (req, res) => {
    res.json(await writePlan(actorOf(req), trip(req), writeSchema.parse(req.body)));
  })
);

router.get(
  "/plans/:planId/collab",
  route(async (req, res) => {
    res.json(await collab(actorOf(req), trip(req)));
  })
);

router.post(
  "/plans/:planId/notices/read",
  route(async (req, res) => {
    res.json(await markNoticesRead(actorOf(req), trip(req)));
  })
);

const refresh = z.object({ clientRef: uuid, baseRevision: z.number().int().min(1) }).strict();

router.post(
  "/plans/:planId/forecast",
  route(async (req, res) => {
    res.json(await refreshForecast(actorOf(req), trip(req), refresh.parse(req.body)));
  })
);

router.post(
  "/plans/:planId/stations/:stationId/climate",
  route(async (req, res) => {
    const stationId = uuid.parse(req.params.stationId);
    res.json(
      await refreshStationClimate(actorOf(req), trip(req), stationId, refresh.parse(req.body))
    );
  })
);

router.post(
  "/plans/:planId/stages/:stageId/route",
  route(async (req, res) => {
    const body = refresh.parse(req.body);
    const stageId = uuid.parse(req.params.stageId);
    const replayed = await findReceipt(actorOf(req), trip(req), body.clientRef);
    if (replayed) {
      res.json(replayed);
      return;
    }
    const access = await planAccess(actorOf(req), trip(req));
    // The provider call counts against the owner's limits (spec §6.5).
    const metrics = await routeStage(access.ownerId, parseState(access.row.state), stageId);
    res.json(
      await writePlan(actorOf(req), trip(req), {
        ...body,
        operation: { type: "stage_metrics", stageId, ...metrics },
      })
    );
  })
);

router.post(
  "/plans/:planId/placeholder-matches",
  route(async (req, res) => {
    const body = z.object({ booking: bookingSchema }).strict().parse(req.body);
    const plan = await accessiblePlan(actorOf(req), trip(req));
    res.json({ matches: matchPlaceholders(body.booking, parseState(plan.state)) });
  })
);

router.get(
  "/plans/:planId/packing-suggestions",
  route(async (req, res) => {
    const plan = await accessiblePlan(actorOf(req), trip(req));
    res.json({ suggestions: packingSuggestions(parseState(plan.state)) });
  })
);

const language = z.enum(["de", "en"]).default("de");
router.get(
  "/plans/:planId/locations",
  route(async (req, res) => {
    const q = z.object({ q: z.string().trim().min(2).max(120), language }).parse(req.query);
    const access = await planAccess(actorOf(req), trip(req));
    res.json({ locations: await findLocations(access.ownerId, q.q, q.language) });
  })
);

router.get(
  "/plans/:planId/places",
  route(async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().min(2).max(120),
        language,
        kind: z.enum(["any", "port"]).default("any"),
      })
      .parse(req.query);
    const access = await planAccess(actorOf(req), trip(req));
    res.json(await searchPlaces(access.ownerId, q.q, q.language, q.kind));
  })
);

// ---- The trip as a file (spec §6.6 leaving, §6.7 the guest's own logbook copy) ----------------
/**
 * The plan's trip as a `.travstats` file: what the handover wrote to the owner's logbook — the
 * roadtrip with its stations, legs and ferry links (format version 4), stays and crossings — in
 * its public half. Documents, photos, the journal, notes, prices and companions are the owner's
 * and are not in it (`private: false`). Planned but not yet confirmed stations live in the plan,
 * not in the trip, so they are not in the file either; the guest imports it on their own server
 * with the ordinary single-trip import. Read-only: it changes nothing on this server.
 */
router.get(
  "/plans/:planId/export",
  route(async (req, res) => {
    const { ownerId } = await planAccess(actorOf(req), trip(req));
    const options = { documents: false, photos: false, private: false };
    const collected = presentFiles(await collectTrip(ownerId, trip(req), options));
    const now = new Date();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileSlug(collected.tripName)}-${now.toISOString().slice(0, 10)}${TRIP_FILE_EXTENSION}"`
    );
    try {
      await writeTripArchive(collected, buildManifest(options, now, collected.file), res);
    } catch (error) {
      if (res.headersSent) {
        logger.error({ operation: "guest_trip_export_stream_failed", err: error });
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      throw error;
    }
    logger.info({ operation: "guest_trip_export", planId: req.guest!.planId });
  })
);

// ---- Documents the plan shows to its members (D6) ---------------------------------------------
const fileUrl = (planId: string, id: string) =>
  `/api/v1/guest/plans/${planId}/documents/${id}/file`;

router.get(
  "/plans/:planId/documents",
  route(async (req, res) => {
    const documents = await listPlanDocuments(actorOf(req), trip(req));
    res.json({
      documents: documents.map((d) => ({ ...d, url: fileUrl(req.guest!.planId, d.id) })),
    });
  })
);

router.post(
  "/plans/:planId/documents",
  planDocumentUpload,
  route(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw new AppError("No file uploaded (multipart field `file`)", 400);
    const fields = z.object({ bookingId: uuid.optional() }).parse(req.body ?? {});
    const dto = await uploadPlanDocument(actorOf(req), trip(req), file, fields.bookingId);
    res.status(201).json({ ...dto, url: fileUrl(req.guest!.planId, dto.id) });
  })
);

router.get(
  "/plans/:planId/documents/:documentId/file",
  route(async (req, res) => {
    const doc = await readPlanDocument(actorOf(req), trip(req), uuid.parse(req.params.documentId));
    const filePath = documentPath(doc.storedName);
    if (!fs.existsSync(filePath))
      throw new AppError("Document file missing", 404, "PLAN_DOCUMENT_NOT_FOUND");
    // The owner's kept original, served from the host's origin: never rendered as a page.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.type(doc.mimetype);
    res.attachment(doc.originalName ?? "document");
    res.sendFile(filePath);
  })
);

// What a guest may not do has no handler; the rest of the plan API is simply not theirs.
export default router;
