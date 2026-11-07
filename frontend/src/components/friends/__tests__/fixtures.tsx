import type { LeaderboardScope, PersonView } from "../../../lib/comparison/types";

export const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
export const person = (id: string, name: string, origin: string | null = null) => ({
  key: `${origin ? "remote" : "local"}:${id}`,
  kind: origin ? ("remote" as const) : ("local" as const),
  username: name.toLowerCase(),
  displayName: name,
  origin,
});
export const friendView = (
  p: ReturnType<typeof person>,
  theirs: PersonView["theirs"] = { status: "accepted" }
): PersonView => ({
  person: p,
  mine: { consentId: `c-${p.key}`, status: "accepted", scope: SCOPE },
  theirs,
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
