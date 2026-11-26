/** Admin runtime report (perf audit 2026-11, item 4). Bare response family. */
import { registry } from "../registry";
import { errorContent } from "./shared";
import { runtimeReportSchema } from "../../../schemas/runtime";

registry.registerPath({
  method: "get",
  path: "/admin/runtime",
  summary: "What the server process and its database are doing right now",
  description:
    "Event-loop delay (p50/p99/max of the last minute), RSS and heap against the heap limit, the " +
    "database ping and connection pool, the ten slowest statements by mean time when " +
    "pg_stat_statements is installed and preloaded (`status` says which step is missing " +
    "otherwise), the heavy-job and import write slots, and the most recent slow requests " +
    "(over 1 s) and queries (over 500 ms). Statement texts are normalised by Postgres.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The runtime report",
      content: { "application/json": { schema: runtimeReportSchema } },
    },
    403: { description: "Not an admin", content: errorContent },
  },
});
