import type { ManagedCompanion } from "../../../lib/api/companions";
import type { PersonView, RequestView } from "../../../lib/comparison/types";
import type { ShareConsent, ShareConsentList, SharePerson } from "../../../types/sharing";
import type { Connection, RemotePerson } from "../../../types/sharingRemote";

/** What the list says about a person's account. */
export type AccountStatus = "connected" | "requested" | "unlinked";

/** The account behind a row: on this server, or `user@server`. */
export type PersonAccount =
  | { kind: "local"; userId: string; username: string; displayName: string }
  | { kind: "remote"; origin: string; username: string; displayName: string };

/**
 * One row of "Personen": a companion and the account it is linked to are ONE person, an account
 * nobody has made a companion of is one too, and so is a person on another server. Each switch's
 * record stays its own (the share consent, the leaderboard consent). Encrypted hand-over links carry no account id, so they are never attached to a row.
 */
export interface PersonEntry {
  key: string;
  name: string;
  companion: ManagedCompanion | null;
  account: PersonAccount | null;
  status: AccountStatus;
  /** The caller's request to a local account: what "Reisen teilen" switches. */
  shareConsent: ShareConsent | null;
  /** An accepted request FROM this account: it shares with the caller, who may withdraw it. */
  incomingConsent: ShareConsent | null;
  /** The connection to a person on another server. */
  connection: Connection | null;
  /** A person paired with an invitation code (before connections existed). */
  paired: RemotePerson | null;
  comparison: PersonView | null;
}

/** A question waiting for the caller's answer, shown above the list. */
export type PendingRequest =
  | { kind: "share"; id: string; person: SharePerson; consent: ShareConsent }
  | { kind: "connection"; id: string; connection: Connection }
  | { kind: "comparison"; id: string; request: RequestView };

export interface PeopleSources {
  companions: readonly ManagedCompanion[] | null;
  consents: ShareConsentList | null;
  connections: readonly Connection[] | null;
  pairedPeople: readonly RemotePerson[] | null;
  comparisonPeople: readonly PersonView[] | null;
  comparisonRequests: readonly RequestView[] | null;
}

/** Connection states drawn as a person row; the others are requests above the list or gone. */
const LISTED_STATES: ReadonlySet<Connection["state"]> = new Set(["pending_out", "active"]);

const lower = (text: string): string => text.trim().toLowerCase();
const stripSlash = (origin: string): string => lower(origin).replace(/\/+$/, "");
const live = (list: readonly ShareConsent[]): ShareConsent[] =>
  list.filter((c) => c.status === "pending" || c.status === "accepted");

function statusOf(consent: ShareConsent | null, linked: boolean): AccountStatus {
  if (consent?.status === "accepted") return "connected";
  if (consent?.status === "pending") return "requested";
  return linked ? "connected" : "unlinked";
}

/** Merges every source into one list of people and the questions waiting on the caller. */
export function buildPeople(src: PeopleSources): {
  people: PersonEntry[];
  requests: PendingRequest[];
} {
  const outgoing = new Map<string, ShareConsent>();
  for (const c of live(src.consents?.outgoing ?? [])) outgoing.set(c.person.id, c);
  const incoming = new Map<string, ShareConsent>();
  for (const c of src.consents?.incoming ?? [])
    if (c.status === "accepted") incoming.set(c.person.id, c);
  const takenIncoming = new Set<string>();
  const takeIncoming = (userId: string): ShareConsent | null => {
    const found = takenIncoming.has(userId) ? null : (incoming.get(userId) ?? null);
    if (found) takenIncoming.add(userId);
    return found;
  };
  const comparison = src.comparisonPeople ?? [];
  const findComparison = (username: string, origin: string | null): PersonView | null =>
    comparison.find(
      (p) =>
        p.person.kind !== "self" &&
        // Usernames are unique case-SENSITIVELY: "Alice" and "alice" are two accounts.
        p.person.username === username &&
        (origin === null
          ? p.person.origin === null
          : stripSlash(p.person.origin ?? "") === stripSlash(origin))
    ) ?? null;
  const used = new Set<PersonView>();
  const claimComparison = (username: string, origin: string | null): PersonView | null => {
    const found = findComparison(username, origin);
    if (found) used.add(found);
    return found;
  };
  const people: PersonEntry[] = [];
  const covered = new Set<string>();
  // A companion linked to a person on another server is that person: one row, not two
  // ("kein Konto" plus the connection — sharing UAT 2).
  const remoteRows = new Map<string, Connection>();
  for (const c of src.connections ?? []) remoteRows.set(c.id, c);
  const takenRemote = new Set<string>();
  for (const companion of src.companions ?? []) {
    const user = companion.linkedUser;
    const consent = user ? (outgoing.get(user.id) ?? null) : null;
    if (user) covered.add(user.id);
    const conn = !user && companion.linkedRemoteId ? remoteRows.get(companion.linkedRemoteId) : null;
    const remote = conn && LISTED_STATES.has(conn.state) ? conn : null;
    if (remote) takenRemote.add(remote.id);
    people.push({
      key: `c:${companion.id}`,
      name: companion.name,
      companion,
      account: user
        ? { kind: "local", userId: user.id, username: user.username, displayName: user.displayName }
        : remote
          ? {
              kind: "remote",
              origin: remote.origin,
              username: remote.username,
              displayName: remote.displayName,
            }
          : null,
      status: user
        ? statusOf(consent, true)
        : remote
          ? remote.state === "active"
            ? "connected"
            : "requested"
          : "unlinked",
      shareConsent: consent,
      incomingConsent: user ? takeIncoming(user.id) : null,
      connection: remote,
      paired: null,
      comparison: user
        ? claimComparison(user.username, null)
        : remote
          ? claimComparison(remote.username, remote.origin)
          : null,
    });
  }
  // Accounts that answered or were asked but are nobody's companion yet.
  for (const consent of outgoing.values()) {
    if (covered.has(consent.person.id)) continue;
    covered.add(consent.person.id);
    const p = consent.person;
    people.push({
      key: `u:${p.id}`,
      name: p.displayName,
      companion: null,
      account: { kind: "local", userId: p.id, username: p.username, displayName: p.displayName },
      status: statusOf(consent, false),
      shareConsent: consent,
      incomingConsent: takeIncoming(p.id),
      connection: null,
      paired: null,
      comparison: claimComparison(p.username, null),
    });
  }
  // Accounts that share with the caller and nobody else row stands for: the caller can still withdraw.
  for (const consent of incoming.values()) {
    if (takenIncoming.has(consent.person.id)) continue;
    takenIncoming.add(consent.person.id);
    const p = consent.person;
    people.push({
      key: `i:${p.id}`,
      name: p.displayName,
      companion: null,
      account: { kind: "local", userId: p.id, username: p.username, displayName: p.displayName },
      status: "connected",
      shareConsent: null,
      incomingConsent: consent,
      connection: null,
      paired: null,
      comparison: claimComparison(p.username, null),
    });
  }
  // People on other servers: one row per connection that is not a question waiting on the caller.
  for (const c of src.connections ?? []) {
    if (!LISTED_STATES.has(c.state) || takenRemote.has(c.id)) continue;
    people.push({
      key: `r:${c.id}`,
      name: c.displayName,
      companion: null,
      account: {
        kind: "remote",
        origin: c.origin,
        username: c.username,
        displayName: c.displayName,
      },
      status: c.state === "active" ? "connected" : "requested",
      shareConsent: null,
      incomingConsent: null,
      connection: c,
      paired: null,
      comparison: claimComparison(c.username, c.origin),
    });
  }
  // People paired with an invitation code that no connection stands for yet.
  const connected = new Set(
    (src.connections ?? []).map((c) => `${stripSlash(c.origin)}|${c.username}`)
  );
  for (const person of src.pairedPeople ?? []) {
    if (person.consent !== "accepted" && person.consent !== "pending") continue;
    if (connected.has(`${stripSlash(person.origin)}|${person.username}`)) continue;
    people.push({
      key: `k:${person.id}`,
      name: person.displayName,
      companion: null,
      account: {
        kind: "remote",
        origin: person.origin,
        username: person.username,
        displayName: person.displayName,
      },
      status: person.consent === "accepted" ? "connected" : "requested",
      shareConsent: null,
      incomingConsent: null,
      connection: null,
      paired: person,
      comparison: claimComparison(person.username, person.origin),
    });
  }
  // Leaderboard people no other source knows: they must not vanish from the list.
  for (const view of comparison) {
    if (used.has(view) || view.person.kind === "self") continue;
    const p = view.person;
    people.push({
      key: `p:${p.key}`,
      name: p.displayName,
      companion: null,
      account:
        p.origin === null
          ? { kind: "local", userId: p.key, username: p.username, displayName: p.displayName }
          : { kind: "remote", origin: p.origin, username: p.username, displayName: p.displayName },
      status: view.mine?.status === "accepted" ? "connected" : "requested",
      shareConsent: null,
      incomingConsent: null,
      connection: null,
      paired: null,
      comparison: view,
    });
  }

  const requests: PendingRequest[] = [
    ...live(src.consents?.incoming ?? [])
      .filter((c) => c.status === "pending")
      .map((c): PendingRequest => ({ kind: "share", id: c.id, person: c.person, consent: c })),
    ...(src.connections ?? [])
      .filter((c) => c.state === "pending_in" || c.state === "reconfirm")
      .map((c): PendingRequest => ({ kind: "connection", id: c.id, connection: c })),
    ...(src.comparisonRequests ?? []).map((r): PendingRequest => ({
      kind: "comparison",
      id: r.consentId,
      request: r,
    })),
  ];
  return { people, requests };
}
