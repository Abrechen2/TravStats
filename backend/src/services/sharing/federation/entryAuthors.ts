/**
 * Who brought each entry into a share group (F-S4e review): what a resend across servers names
 * per entry, so a spoke copies only what its person said yes to.
 *
 * Recorded only where it is known, never inferred:
 * - when a row gets its key on its owner's own trip (`assignShareKeys` on a first share, a new
 *   or moved-in entry in `spreadCreate`) — a copy arrives with its key already, so a row keyed
 *   here is provably its owner's own;
 * - when an entry from another server first spreads at the home (`spreadCreate`, its author's
 *   roster ref).
 * Before a group is shared across servers, a local author is stored as `local:<account id>` and
 * read as their roster ref once the group has one. An entry without a record has no author the
 * home can vouch for, and is sent named by nobody — the spoke copies it for nobody.
 */
import type { DbTransaction } from "../../../db";
import type { ChangeAuthor } from "./outbound";
import { userRef } from "./rosterRef";

const LOCAL = "local:";

/** Record who brought `shareKey` into `groupId`; the first record stays. */
export async function recordEntryAuthor(
  c: Pick<DbTransaction, "tripShareGroup" | "tripShareEntryAuthor">,
  groupId: string,
  shareKey: string,
  author: ChangeAuthor
): Promise<void> {
  const group = await c.tripShareGroup.findUnique({
    where: { id: groupId },
    select: { federatedRef: true, homeOrigin: true },
  });
  // A spoke's group: its home keeps the record, and a spoke never resends entries.
  if (!group || group.homeOrigin) return;
  const ref =
    author.kind === "user"
      ? group.federatedRef
        ? userRef(group.federatedRef, author.id)
        : `${LOCAL}${author.id}`
      : author.ref;
  if (!ref) return;
  await c.tripShareEntryAuthor.upsert({
    where: { groupId_shareKey: { groupId, shareKey } },
    create: { groupId, shareKey, authorRef: ref },
    update: {},
  });
}

/** The recorded authors of a federated group, each as a roster ref. */
export async function entryAuthorRefs(
  c: Pick<DbTransaction, "tripShareEntryAuthor">,
  groupId: string,
  federatedRef: string
): Promise<Map<string, string>> {
  const rows = await c.tripShareEntryAuthor.findMany({ where: { groupId } });
  return new Map(
    rows.map((r) => [
      r.shareKey,
      r.authorRef.startsWith(LOCAL)
        ? userRef(federatedRef, r.authorRef.slice(LOCAL.length))
        : r.authorRef,
    ])
  );
}
