import { z } from "zod";
import { ToolFailure, describeFailure } from "./errors";
import type { Draft, DraftSource } from "./drafts";
import {
  assertAddable,
  flightFieldsFrom,
  planCruise,
  planFlight,
  planRail,
  planRental,
  planRide,
  type Plan,
} from "./entryAdapters";
import { loadFile, type LoadedFile } from "./files";
import type { ApiClient } from "./client";
import { WRITES, confirmField, dryRun, idOf, store, type Rec } from "./writeCommon";
import type { ToolContext, ToolDef, ToolResult } from "./types";

/** --- adding entries ------------------------------------------------------------------------- */

const stationFields = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    country: z.string().length(2).optional(),
  })
  .strict();
const wall = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "YYYY-MM-DDTHH:mm, the local clock at that place");

/** Every field optional: a draft supplies most, and the adapters name what is still missing. */
const optional = (shape: z.ZodRawShape): z.ZodRawShape =>
  Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, (v as z.ZodType).optional()]));

const flightEntry = z
  .object({
    domain: z.literal("flight"),
    ...optional({
      airline: z.string().max(100).optional(),
      flightNumber: z.string().max(10).optional(),
      departureAirport: z.string().min(3).max(4).describe("IATA or ICAO code"),
      arrivalAirport: z.string().min(3).max(4),
      departureLocal: wall,
      arrivalLocal: wall,
      bookingReference: z.string().max(20).optional(),
      ticketNumber: z.string().max(30).optional(),
      seatNumber: z.string().max(10).optional(),
      seatClass: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
      gate: z.string().max(20).optional(),
      terminal: z.string().max(20).optional(),
      price: z.number().min(0).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      status: z.enum(["scheduled", "flown", "historical"]).optional(),
      tripId: z.string().uuid().optional(),
      notes: z.string().max(2000).optional(),
    }),
  })
  .strict();
const rideCommon = {
  operator: z.string().max(100).optional(),
  departureStation: stationFields,
  arrivalStation: stationFields,
  departureLocal: wall,
  arrivalLocal: wall.optional(),
  bookingReference: z.string().max(40).optional(),
  seat: z.string().max(20).optional(),
  fareClass: z.string().max(40).optional(),
  price: z.number().min(0).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  tripId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
};
const busEntry = z
  .object({
    domain: z.literal("bus"),
    ...optional({ lineName: z.string().max(40), ...rideCommon }),
  })
  .strict();
const ferryEntry = z
  .object({
    domain: z.literal("ferry"),
    ...optional({ vesselName: z.string().max(100), ...rideCommon }),
  })
  .strict();
/** The fields to fill in or correct by hand; a draft supplies the rest. */
const entryField = z
  .discriminatedUnion("domain", [flightEntry, busEntry, ferryEntry])
  .optional()
  .describe(
    "Explicit fields (flight, bus or ferry) — complete what a draft lacks, or add an entry with no draft."
  );

const addInput = {
  draftId: z
    .string()
    .uuid()
    .optional()
    .describe("From parse_booking / parse_flight_text / parse_boarding_pass."),
  itemIndex: z.number().int().min(0).max(20).default(0).describe("Which reading of the draft."),
  entry: entryField,
  sourceFileName: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("Without a draft: the original document to attach (a file in the files folder)."),
  confirm: confirmField,
};

function sourceDocument(source: DraftSource): LoadedFile | null {
  if (!source) return null;
  if (source.kind === "file") return source.file;
  return {
    name: "booking-text.txt",
    kind: "text",
    mimeType: "text/plain",
    bytes: Buffer.from(source.text, "utf8"),
  };
}

export async function uploadFile(
  client: ApiClient,
  file: LoadedFile,
  tool: string,
  extra: Record<string, string | undefined> = {}
): Promise<string> {
  const res = await client.postForm<{ data?: { id?: unknown } }>(
    "/documents",
    { field: "file", bytes: file.bytes, fileName: file.name, mimeType: file.mimeType },
    { kind: "booking", source: "upload", displayName: file.name, ...extra },
    { tool }
  );
  const id = res.data?.id;
  if (typeof id !== "string")
    throw new ToolFailure("server", "The server did not return the document's id.");
  return id;
}

async function planFor(
  ctx: ToolContext,
  domain: string,
  item: Rec,
  entry: Rec | undefined
): Promise<Plan> {
  assertAddable(domain);
  switch (domain) {
    case "flight":
      return planFlight(ctx.client, flightFieldsFrom(item, entry));
    case "cruise":
      return planCruise(item);
    case "rail":
      return planRail(item);
    case "rental":
      return planRental(item);
    default:
      return planRide(domain, item, entry);
  }
}

async function addEntry(
  ctx: ToolContext,
  tool: string,
  a: Rec,
  onlyDomain?: "flight"
): Promise<ToolResult> {
  const entry = a.entry as Rec | undefined;
  let draft: Draft | null = null;
  let domain: string;
  let item: Rec = {};
  if (a.draftId) {
    draft = store(ctx).get(a.draftId as string);
    domain = draft.domain;
    const found = draft.items[a.itemIndex as number];
    if (!found)
      throw new ToolFailure(
        "invalid_input",
        `The draft has ${draft.items.length} reading(s); itemIndex ${String(a.itemIndex)} does not exist.`
      );
    item = found;
    if (entry && entry.domain !== domain)
      throw new ToolFailure(
        "invalid_input",
        `entry.domain "${String(entry.domain)}" does not match the draft's domain "${domain}".`
      );
  } else {
    if (!entry)
      throw new ToolFailure("invalid_input", "Give a draftId, or `entry` with explicit fields.");
    domain = entry.domain as string;
  }
  if (onlyDomain && domain !== onlyDomain)
    throw new ToolFailure(
      "invalid_input",
      `This tool adds ${onlyDomain}s; use add_entry_from_draft for "${domain}".`
    );
  const plan = await planFor(ctx, domain, item, entry);
  const original =
    sourceDocument(draft?.source ?? null) ??
    (typeof a.sourceFileName === "string"
      ? await loadFile(ctx.filesDir ?? null, a.sourceFileName)
      : null);
  const warnings = [
    ...plan.warnings,
    ...(original
      ? []
      : [
          "No original document is attached: there is no draft source. Pass sourceFileName to attach one.",
        ]),
  ];
  if (a.confirm !== true) {
    return dryRun(
      `Would create ${plan.requests.length} ${domain} entr${plan.requests.length === 1 ? "y" : "ies"}${original ? ` and attach ${original.name}` : ""}.`,
      {
        requests: plan.requests.map((r) => ({ path: r.path, body: r.body, label: r.label })),
        attachOriginal: original?.name ?? null,
      },
      { skipped: plan.skipped, warnings }
    );
  }
  const documentId = original ? await uploadFile(ctx.client, original, tool) : null;
  const entries: Array<{ id: string; link: string; label: string }> = [];
  let failure: string | undefined;
  for (const [i, req] of plan.requests.entries()) {
    const key = `mcp-${draft?.id ?? "direct"}-${String(a.itemIndex ?? 0)}-${i}`.slice(0, 64);
    const body = {
      ...req.body,
      ...(i === 0 && documentId ? { documentIds: [documentId] } : {}),
      ...(req.path === "/rentals/import" ? {} : { clientRef: key }),
    };
    try {
      const res = await ctx.client.post<Rec>(req.path, body, { tool });
      const id = idOf(res);
      if (!id) throw new ToolFailure("server", "The server created the entry but returned no id.");
      entries.push({ id, link: `${ctx.instance}/${req.segment}/${id}`, label: req.label });
    } catch (err) {
      if (!(err instanceof ToolFailure)) throw err;
      if (i === 0) {
        const kept = documentId
          ? ` The original stays in the inbox as an unfiled document (${documentId}).`
          : "";
        throw new ToolFailure(err.reason, `${err.message}${kept}`, err.details);
      }
      failure = `Leg ${i + 1} (${req.label}) failed: ${describeFailure(err)}`;
      break;
    }
  }
  const [first] = entries;
  return {
    summary: `Created ${entries.length} ${domain} entr${entries.length === 1 ? "y" : "ies"}${documentId ? "; the original document is attached to the first" : ""}${failure ? `. PARTIAL: ${failure}` : "."}`,
    data: {
      written: true,
      id: first.id,
      link: first.link,
      documentId,
      documentAttached: documentId !== null,
      entries,
      skipped: plan.skipped,
      warnings,
      ...(failure ? { partial: true, failure } : {}),
    },
  };
}

const add_entry_from_draft: ToolDef = {
  name: "add_entry_from_draft",
  title: "Add an entry from a draft",
  description: `${WRITES} Saves a draft from parse_booking (or explicit fields) as a flight, rail ride, cruise, rental, bus or ferry entry and ALWAYS attaches the original document to it. Stays, package tours and places are reviewed on the web instead. Never deletes or merges.`,
  write: true,
  untrusted: true,
  wraps: [
    {
      method: "POST",
      path: "/flights",
      body: ["departure", "arrival", "departureLocal", "documentIds", "clientRef"],
      fields: ["flight.id"],
    },
    { method: "POST", path: "/cruises", body: ["documentIds", "clientRef"], fields: ["data.id"] },
    {
      method: "POST",
      path: "/rail",
      body: ["departureStation", "arrivalStation", "departureLocal", "documentIds", "clientRef"],
      fields: ["data.id"],
    },
    {
      method: "POST",
      path: "/rentals/import",
      body: ["kind", "input", "documentIds"],
      fields: ["data.id"],
    },
    {
      method: "POST",
      path: "/bus",
      body: ["departureStation", "arrivalStation", "departureLocal", "documentIds", "clientRef"],
      fields: ["data.id"],
    },
    {
      method: "POST",
      path: "/ferry",
      body: ["departureStation", "arrivalStation", "departureLocal", "documentIds", "clientRef"],
      fields: ["data.id"],
    },
    { method: "POST", path: "/documents", fields: ["data.id"] },
    { method: "GET", path: "/airports/{code}" },
  ],
  input: addInput,
  run: (ctx, a) => addEntry(ctx, "add_entry_from_draft", a),
};

const add_flight: ToolDef = {
  name: "add_flight",
  title: "Add a flight",
  description: `${WRITES} Adds ONE flight from a flight draft (parse_flight_text / parse_boarding_pass / parse_booking) or from explicit fields, resolves both airports in the server's catalogue (a missing time zone refuses instead of guessing UTC) and attaches the original document.`,
  write: true,
  untrusted: true,
  wraps: [
    {
      method: "POST",
      path: "/flights",
      body: ["departure", "arrival", "departureLocal", "arrivalLocal", "documentIds", "clientRef"],
      fields: ["flight.id"],
    },
    { method: "POST", path: "/documents", fields: ["data.id"] },
    { method: "GET", path: "/airports/{code}" },
  ],
  input: addInput,
  run: (ctx, a) => addEntry(ctx, "add_flight", a, "flight"),
};

export const ADD_TOOLS: ToolDef[] = [add_flight, add_entry_from_draft];
