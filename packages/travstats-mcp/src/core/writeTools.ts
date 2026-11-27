import { z } from "zod";
import { ToolFailure, describeFailure } from "./errors";
import { PARSE_TOOLS } from "./parseTools";
import { ADD_TOOLS, uploadFile } from "./addTools";
import { loadFile } from "./files";
import { WRITES, confirmField, dryRun, idOf, type Rec } from "./writeCommon";
import type { ToolDef } from "./types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** --- places, inbox, routing, documents ------------------------------------------------------ */

const add_place_visit: ToolDef = {
  name: "add_place_visit",
  title: "Add a place visit",
  description: `${WRITES} Records a visit to a place (an existing placeId, or a new place with name and coordinates). If the visit fails after the place was created, the answer says "partial" with the new placeId so a retry reuses it.`,
  write: true,
  wraps: [
    { method: "POST", path: "/places", body: ["name", "lat", "lon", "clientRef"], fields: ["id"] },
    {
      method: "POST",
      path: "/places/{id}/visits",
      body: ["visitedAt", "notes", "clientRef"],
      fields: ["data.id"],
    },
  ],
  input: {
    placeId: z.string().uuid().optional(),
    place: z
      .object({
        name: z.string().min(1).max(200),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
      .strict()
      .optional(),
    date: day,
    note: z.string().max(5000).optional(),
    confirm: confirmField,
  },
  async run(ctx, a) {
    if (!a.placeId === !a.place)
      throw new ToolFailure("invalid_input", "Give exactly one of placeId and place.");
    const visit = { visitedAt: a.date, ...(a.note ? { notes: a.note } : {}) };
    if (a.confirm !== true)
      return dryRun("Would add a place visit.", {
        place: a.place ?? { placeId: a.placeId },
        visit,
      });
    const stamp = `${String(a.date)}-${String(a.placeId ?? (a.place as Rec).name)}`
      .replace(/[^A-Za-z0-9._:-]/g, "")
      .slice(0, 40);
    let placeId = a.placeId as string | undefined;
    let createdPlace = false;
    if (!placeId) {
      const res = await ctx.client.post<Rec>(
        "/places",
        { ...(a.place as Rec), clientRef: `mcp-pl-${stamp}` },
        { tool: "add_place_visit" }
      );
      placeId = idOf(res);
      if (!placeId)
        throw new ToolFailure("server", "The server created the place but returned no id.");
      createdPlace = true;
    }
    try {
      const res = await ctx.client.post<Rec>(
        `/places/${encodeURIComponent(placeId)}/visits`,
        { ...visit, clientRef: `mcp-pv-${stamp}` },
        { tool: "add_place_visit" }
      );
      const visitId = idOf(res);
      return {
        summary: `Visit added${createdPlace ? " (new place created)" : ""}.`,
        data: {
          written: true,
          placeId,
          visitId,
          link: `${ctx.instance}/places/${placeId}`,
          createdPlace,
        },
      };
    } catch (err) {
      if (!(err instanceof ToolFailure) || !createdPlace) throw err;
      return {
        summary: `PARTIAL: the place was created but the visit failed. Retry with placeId ${placeId}. ${describeFailure(err)}`,
        data: {
          written: true,
          partial: true,
          placeId,
          link: `${ctx.instance}/places/${placeId}`,
          failure: describeFailure(err),
        },
      };
    }
  },
};

const INBOX_ACTIONS = {
  trip_suggestion: ["accept", "dismiss"],
  location_suggestion: ["accept", "reject"],
  data_quality: ["resolve", "dismiss"],
  pending_update: ["apply", "reject"],
  provenance_notice: ["dismiss"],
} as const;

const resolve_inbox_item: ToolDef = {
  name: "resolve_inbox_item",
  title: "Answer an inbox item",
  description: `${WRITES} Answers one inbox item from list_inbox with the action that kind offers (trip_suggestion: accept|dismiss; location_suggestion: accept|reject; data_quality: resolve|dismiss; pending_update: apply|reject; provenance_notice: dismiss). Duplicate merges are not available here. A data-quality answer carries the flag's own revision, so an answer on stale data fails instead of overwriting.`,
  write: true,
  wraps: [
    { method: "POST", path: "/trip-suggestions/{id}/accept" },
    { method: "POST", path: "/trip-suggestions/{id}/dismiss" },
    { method: "POST", path: "/location-suggestions/{id}/accept" },
    { method: "POST", path: "/location-suggestions/{id}/reject" },
    { method: "GET", path: "/data-quality-flags", query: ["status"] },
    { method: "POST", path: "/data-quality-flags/{id}/resolve", body: ["revision"] },
    { method: "POST", path: "/data-quality-flags/{id}/dismiss", body: ["revision"] },
    { method: "POST", path: "/pending-updates/{id}/apply" },
    { method: "POST", path: "/pending-updates/reject", body: ["ids"] },
    { method: "POST", path: "/provenance/notices/{id}/dismiss" },
  ],
  input: {
    kind: z.enum(
      Object.keys(INBOX_ACTIONS) as [
        keyof typeof INBOX_ACTIONS,
        ...Array<keyof typeof INBOX_ACTIONS>,
      ]
    ),
    id: z.string().min(1).max(100),
    action: z.enum(["accept", "dismiss", "reject", "resolve", "apply"]),
    confirm: confirmField,
  },
  async run(ctx, a) {
    const kind = a.kind as keyof typeof INBOX_ACTIONS;
    const action = a.action as string;
    if (!(INBOX_ACTIONS[kind] as readonly string[]).includes(action))
      throw new ToolFailure(
        "invalid_input",
        `A ${kind} can only be answered with: ${INBOX_ACTIONS[kind].join(", ")}.`
      );
    const id = encodeURIComponent(a.id as string);
    const route: Record<string, { path: string; body?: Rec }> = {
      "trip_suggestion/accept": { path: `/trip-suggestions/${id}/accept` },
      "trip_suggestion/dismiss": { path: `/trip-suggestions/${id}/dismiss` },
      "location_suggestion/accept": { path: `/location-suggestions/${id}/accept` },
      "location_suggestion/reject": { path: `/location-suggestions/${id}/reject` },
      "data_quality/resolve": { path: `/data-quality-flags/${id}/resolve` },
      "data_quality/dismiss": { path: `/data-quality-flags/${id}/dismiss` },
      "pending_update/apply": { path: `/pending-updates/${id}/apply` },
      "pending_update/reject": { path: "/pending-updates/reject", body: { ids: [a.id] } },
      "provenance_notice/dismiss": { path: `/provenance/notices/${id}/dismiss` },
    };
    const target = route[`${kind}/${action}`];
    if (a.confirm !== true)
      return dryRun(`Would ${action} the ${kind} ${String(a.id)}.`, {
        path: target.path,
        body: target.body ?? {},
      });
    let body: Rec = target.body ?? {};
    if (kind === "data_quality") {
      const list = await ctx.client.get<{ flags?: Rec[] }>("/data-quality-flags", {
        status: "open",
      });
      const flag = (list.flags ?? []).find((f) => f.id === a.id);
      if (!flag)
        throw new ToolFailure("not_found", "That data-quality flag is not open (any more).");
      if (typeof flag.revision === "number") body = { revision: flag.revision };
    }
    const res = await ctx.client.post<Rec>(target.path, body, { tool: "resolve_inbox_item" });
    return {
      summary: `${kind} ${String(a.id)}: ${action} done.`,
      data: { written: true, kind, action, result: res },
    };
  },
};

const JOB_WINDOW_MS = 60_000;
const jobStarts: number[] = [];
export function resetJobBudget(): void {
  jobStarts.length = 0;
}
const POLL_EVERY_MS = 2_000;
const POLL_FOR_MS = 30_000;

const reroute_trip_legs: ToolDef = {
  name: "reroute_trip_legs",
  title: "Reroute a route's legs",
  description: `${WRITES} Starts the server's reroute job for a route and waits up to 30 s; if it is not done by then it returns the run id for get_routing_run instead of pretending it finished. One job start per minute.`,
  write: true,
  wraps: [
    { method: "POST", path: "/tours/{routeId}/reroute-all", fields: ["run.id", "run.status"] },
    {
      method: "GET",
      path: "/routing-runs/{id}",
      fields: ["run.status", "run.total", "run.processed"],
    },
  ],
  input: { routeId: z.string().min(1).max(100), confirm: confirmField },
  async run(ctx, a) {
    const path = `/tours/${encodeURIComponent(a.routeId as string)}/reroute-all`;
    if (a.confirm !== true) return dryRun("Would start a reroute job.", { path });
    const now = Date.now();
    while (jobStarts.length && now - jobStarts[0] > JOB_WINDOW_MS) jobStarts.shift();
    if (jobStarts.length >= 1)
      throw new ToolFailure("rate_limited", "Only one job may be started per minute from here.", {
        retryAfterSec: Math.ceil((JOB_WINDOW_MS - (now - jobStarts[0])) / 1000),
      });
    jobStarts.push(now);
    const started = await ctx.client.post<{ run: Rec }>(path, {}, { tool: "reroute_trip_legs" });
    const runId = started.run.id as string;
    const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let run = started.run;
    for (
      let waited = 0;
      waited < POLL_FOR_MS && run.status === "running";
      waited += POLL_EVERY_MS
    ) {
      if (ctx.signal?.aborted) break;
      await sleep(POLL_EVERY_MS);
      if (ctx.signal?.aborted) break;
      run = (await ctx.client.get<{ run: Rec }>(`/routing-runs/${encodeURIComponent(runId)}`)).run;
    }
    const finished = run.status !== "running";
    return {
      summary: finished
        ? `Reroute run ${String(run.status)}: ${String(run.processed)} of ${String(run.total)}.`
        : `Reroute run ${runId} is still running (${String(run.processed)} of ${String(run.total)}). Check it with get_routing_run.`,
      data: {
        written: true,
        runId,
        status: run.status,
        done: run.processed,
        total: run.total,
        finished,
      },
    };
  },
};

const DOC_ENTRY_TYPES = [
  "flight",
  "cruise",
  "lodgingStay",
  "trip",
  "placeVisit",
  "railJourney",
  "rentalBooking",
  "busJourney",
  "ferryJourney",
  "tour",
] as const;

const upload_document: ToolDef = {
  name: "upload_document",
  title: "File a document",
  description: `${WRITES} Files a document (PDF, image, .eml, .txt from the configured files folder) in the user's inbox as an unassigned document, or links it to the given entry. Unfiled documents are removed after the server's retention period if nobody files them.`,
  write: true,
  needsFilesDir: true,
  wraps: [{ method: "POST", path: "/documents", fields: ["data.id"] }],
  input: {
    fileName: z.string().min(1).max(255),
    entry: z
      .object({ type: z.enum(DOC_ENTRY_TYPES), id: z.string().uuid() })
      .strict()
      .optional(),
    kind: z.enum(["invoice", "booking", "boardingPass", "ticket", "other"]).optional(),
    displayName: z.string().min(1).max(255).optional(),
    confirm: confirmField,
  },
  async run(ctx, a) {
    const file = await loadFile(ctx.filesDir ?? null, a.fileName as string);
    const entry = a.entry as { type: string; id: string } | undefined;
    if (a.confirm !== true)
      return dryRun(
        `Would upload ${file.name} (${file.kind}, ${file.bytes.length} bytes) ${entry ? `to ${entry.type} ${entry.id}` : "to the inbox, unassigned"}.`,
        { fileName: file.name, kind: file.kind, bytes: file.bytes.length, entry: entry ?? null }
      );
    const id = await uploadFile(ctx.client, file, "upload_document", {
      kind: (a.kind as string | undefined) ?? "other",
      ...(typeof a.displayName === "string" ? { displayName: a.displayName } : {}),
      ...(entry ? { entryType: entry.type, entryId: entry.id } : {}),
    });
    return {
      summary: entry
        ? `Document filed with the ${entry.type}.`
        : "Document placed in the inbox, unassigned.",
      data: {
        written: true,
        documentId: id,
        filed: !!entry,
        link: entry ? null : `${ctx.instance}/pending-updates`,
      },
    };
  },
};

export const WRITE_TOOLS: ToolDef[] = [
  ...PARSE_TOOLS,
  ...ADD_TOOLS,
  add_place_visit,
  resolve_inbox_item,
  reroute_trip_legs,
  upload_document,
];
