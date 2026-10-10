/**
 * The responses every create that takes a `clientRef` adds (forgejo#283,
 * `services/sync/clientRef.ts`) — one wording for all of them.
 */

import { errorContent } from "./shared";

export function clientRefResponses<C>(replayContent: C) {
  return {
    200: {
      description:
        "A repeat: an earlier POST with the same `clientRef` and the same body already " +
        "created this row. Nothing new was created; the body is the create's.",
      content: replayContent,
    },
    409: {
      description:
        "`CLIENT_REF_REUSED` — the `clientRef` was already spent on a different body or " +
        "another create route. Nothing was created; `kind` and `entityId` name the row the " +
        "key made (PATCH that row to change it).",
      content: errorContent,
    },
    410: {
      description:
        "`CLIENT_REF_TARGET_GONE` — the row this `clientRef` created has been deleted " +
        "since. Nothing was created again; `kind` and `entityId` name it.",
      content: errorContent,
    },
  };
}
