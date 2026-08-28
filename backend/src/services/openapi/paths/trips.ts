/**
 * Trip endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent, tripResponse } from "./shared";

registry.registerPath({
  method: "get",
  path: "/trips",
  summary: "List trips",
  tags: ["Trips"],
  responses: {
    200: {
      description: "Trips",
      content: { "application/json": { schema: z.array(tripResponse) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}",
  summary: "Get a trip",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Trip", content: { "application/json": { schema: tripResponse } } },
    404: { description: "Not found", content: errorContent },
  },
});
