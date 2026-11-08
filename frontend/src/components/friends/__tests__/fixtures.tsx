import type { LeaderboardScope } from "../../../lib/comparison/types";
import type { Friend } from "../../../lib/friends/types";

export const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
export const person = (id: string, name: string, origin: string | null = null) => ({
  key: `${origin ? "remote" : "local"}:${id}`,
  kind: origin ? ("remote" as const) : ("local" as const),
  username: name.toLowerCase(),
  displayName: name,
  origin,
});
/** A connected friend; `over` changes anything, switches included. */
export const friendOf = (p: ReturnType<typeof person>, over: Partial<Friend> = {}): Friend => ({
  key: p.key,
  kind: p.kind,
  username: p.username,
  displayName: p.displayName,
  origin: p.origin,
  state: "active",
  mine: ALL_ON,
  theirs: ALL_ON,
  requestedAt: null,
  confirmedAt: "2026-11-08T00:00:00.000Z",
  scope: SCOPE,
  ...over,
});

/** base64url of a JSON payload, the way the server's `encode` writes it. */
export const b64url = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const VALID_PAYLOAD = {
  v: 1,
  kind: "travstats-friend-invite",
  origin: "https://far.example",
  publicKey: "A".repeat(43),
  fingerprint: "b".repeat(64),
  token: "c".repeat(64),
  expiresAt: "2026-11-10T00:00:00.000Z",
};

/** A button in place of the consent dialog, so a test can answer it with SCOPE. */
export const consentDialogStub = {
  default: ({
    open,
    mode,
    onConfirm,
  }: {
    open: boolean;
    mode: string;
    onConfirm: (s: unknown) => Promise<void>;
  }) =>
    open ? (
      <button data-mode={mode} onClick={() => void onConfirm(SCOPE).catch(() => undefined)}>
        confirm-dialog
      </button>
    ) : null,
};

export const ALL_ON = {
  plans: true,
  stats: "full" as const,
  achievements: true,
  leaderboard: true,
  tripOffers: true,
};

/** A button in place of the switches dialog, so a test can answer it with everything on. */
export const switchesDialogStub = {
  default: ({
    onConfirm,
    title,
  }: {
    onConfirm: (s: typeof ALL_ON) => Promise<void>;
    title: string;
  }) => (
    <button data-title={title} onClick={() => void onConfirm(ALL_ON).catch(() => undefined)}>
      confirm-dialog
    </button>
  ),
};
