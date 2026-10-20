/**
 * `members.ts` answers "who agreed with whom" for both kinds of party (spec 2026-10-20 F3): a
 * local account and a person on another server live in one consent table, so one rule decides
 * for both. The truth table: every status, both directions, a local actor and a remote one.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { CONSENT_STATUSES, type ConsentStatus } from "../../../schemas/sharing";
import {
  acceptedParties,
  acceptedWith,
  partyKey,
  withdrawnParties,
  withdrawnTowards,
  type Party,
} from "../members";

const users: string[] = [];
const ORIGIN = "https://peer.members-mixed.test";

async function user(): Promise<Party> {
  const u = await prisma.user.create({
    data: { username: `mix-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return { kind: "user", id: u.id };
}
async function remote(of: Party): Promise<Party> {
  const r = await prisma.remoteShareAccount.create({
    data: {
      userId: of.id,
      origin: ORIGIN,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "far",
      displayName: "Far",
    },
  });
  return { kind: "remote", id: r.id };
}
const side = (p: Party, as: "requester" | "target") =>
  p.kind === "user"
    ? { [`${as}Id`]: p.id }
    : { [`remote${as[0].toUpperCase()}${as.slice(1)}Id`]: p.id };
async function consent(from: Party, to: Party, status: ConsentStatus) {
  await prisma.shareConsent.create({
    data: { ...side(from, "requester"), ...side(to, "target"), status } as never,
  });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

type Direction = "outgoing" | "incoming";
const CASES: Array<[ConsentStatus, Direction]> = CONSENT_STATUSES.flatMap((s) =>
  (["outgoing", "incoming"] as const).map((d) => [s, d] as [ConsentStatus, Direction])
);

describe.each([
  ["a local actor", "user" as const],
  ["a remote actor", "remote" as const],
])("%s", (_name, actorKind) => {
  it.each(CASES)(
    "status %s (%s): accepted iff accepted, withdrawn iff withdrawn",
    async (status, dir) => {
      const anchor = await user();
      const actor = actorKind === "user" ? anchor : await remote(anchor);
      const localOther = await user();
      // A remote actor never pairs with another remote party here; a local one may.
      const remoteOther = actorKind === "user" ? await remote(anchor) : null;
      const others = [localOther, ...(remoteOther ? [remoteOther] : [])];
      for (const other of others)
        await (dir === "outgoing" ? consent(actor, other, status) : consent(other, actor, status));
      const unrelated = await user();

      const accepted = await acceptedParties(prisma, actor, [...others, unrelated]);
      const withdrawn = await withdrawnParties(prisma, actor, [...others, unrelated]);
      const expectKeys = (wanted: boolean) => (wanted ? others.map(partyKey).sort() : []);
      expect([...accepted].sort()).toEqual(expectKeys(status === "accepted"));
      expect([...withdrawn].sort()).toEqual(expectKeys(status === "withdrawn"));
    }
  );
});

it("lets an accepted pair in one direction outweigh a withdrawn one in the other", async () => {
  const a = await user();
  const b = await user();
  const r = await remote(a);
  await consent(a, b, "withdrawn");
  await consent(b, a, "accepted");
  await consent(a, r, "withdrawn");
  await consent(r, a, "accepted");
  expect([...(await withdrawnParties(prisma, a, [b, r]))]).toEqual([]);
  expect([...(await acceptedParties(prisma, a, [b, r]))].sort()).toEqual(
    [partyKey(b), partyKey(r)].sort()
  );
});

it("keeps the local helpers' answers in user ids, blind to remote parties", async () => {
  const a = await user();
  const b = await user();
  const r = await remote(a);
  await consent(a, b, "accepted");
  await consent(a, r, "accepted");
  expect([...(await acceptedWith(prisma, a.id, [b.id, r.id]))]).toEqual([b.id]);
  await prisma.shareConsent.updateMany({
    where: { requesterId: a.id },
    data: { status: "withdrawn" },
  });
  expect([...(await withdrawnTowards(prisma, a.id, [b.id, r.id]))]).toEqual([b.id]);
});

it("does not read one kind's id as the other's", async () => {
  const a = await user();
  const r = await remote(a);
  await consent(a, r, "accepted");
  // The same id string as a user: no such user pair exists.
  expect([...(await acceptedParties(prisma, a, [{ kind: "user", id: r.id }]))]).toEqual([]);
});
