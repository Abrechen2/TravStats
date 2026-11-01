import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { GEO_FORMATS } from "../../geoExport/geoFile";

/** GPX / KML downloads (forgejo#402), `routes/geoExport.ts`. */

const idParams = z.object({ id: z.string().uuid() });
const formatQuery = z.object({
  format: z.enum(GEO_FORMATS).optional().describe("`gpx` (default) or `kml`"),
});
const placesQuery = formatQuery.extend({
  listId: z.string().uuid().optional().describe("Only the places on this list"),
});

const fileResponse = (what: string) => ({
  description: `${what}, as an attachment`,
  content: {
    "application/gpx+xml": { schema: z.string() },
    "application/vnd.google-earth.kml+xml": { schema: z.string() },
  },
});
const emptyResponse = {
  description: "Nothing to write — `code: GEO_EXPORT_EMPTY`",
  content: errorContent,
};

const rideRoutes = [
  {
    path: "/flights/{id}/track/export",
    tag: "Flights",
    what: "the flight's recorded track",
    nf: "Flight",
  },
  {
    path: "/cruises/{id}/tracks/export",
    tag: "Cruises",
    what: "the cruise's recorded tracks",
    nf: "Cruise",
  },
  {
    path: "/rail/{id}/line/export",
    tag: "Rail",
    what: "the journey's stored line",
    nf: "Rail journey",
  },
  {
    path: "/bus/{id}/line/export",
    tag: "Bus",
    what: "the journey's stored line",
    nf: "Bus journey",
  },
  {
    path: "/ferry/{id}/line/export",
    tag: "Ferry",
    what: "the crossing's stored line",
    nf: "Ferry journey",
  },
];

for (const r of rideRoutes) {
  registry.registerPath({
    method: "get",
    path: r.path,
    summary: `Download ${r.what} as GPX or KML`,
    description:
      "Owner only. The stored (simplified) line, one `<trkseg>` / `LineString` per recording " +
      "segment, with no per-point times. A flight track is privacy-cut like every other reader.",
    tags: [r.tag],
    request: { params: idParams, query: formatQuery },
    responses: {
      200: fileResponse(`GPX 1.1 or KML 2.2 document of ${r.what}`),
      404: { description: `${r.nf} not found`, content: errorContent },
      422: emptyResponse,
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/places/export",
  summary: "Download places as GPX or KML waypoints",
  description:
    "Every place of the account, or those on one list (`listId`). Streamed in pages: the " +
    "document is never built as one string.",
  tags: ["Places"],
  request: { query: placesQuery },
  responses: {
    200: fileResponse("GPX 1.1 or KML 2.2 document with one waypoint per place"),
    404: { description: "Place list not found", content: errorContent },
    422: emptyResponse,
  },
});
