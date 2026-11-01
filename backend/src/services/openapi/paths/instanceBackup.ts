import { z } from "../../../schemas/zod";

import { registry } from "../registry";

/** `routes/settings/instanceBackup.ts`: the server's last backup, for every account. Bare. */
registry.registerPath({
  method: "get",
  path: "/settings/instance-backup",
  summary: "When the server last backed itself up",
  description:
    "Read-only and the same for every account: `completedAt`: the finish time of the newest completed " +
    "instance backup (null when there is none) and whether one is running now. The backup " +
    "list, sizes and targets stay admin-only.",
  tags: ["Settings"],
  responses: {
    200: {
      description: "The last completed backup and whether one is running",
      content: {
        "application/json": {
          schema: z.object({
            completedAt: z.string().datetime().nullable(),
            running: z.boolean(),
          }),
        },
      },
    },
  },
});
