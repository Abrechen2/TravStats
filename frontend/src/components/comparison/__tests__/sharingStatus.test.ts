import { expect, it } from "vitest";
import { fingerprintCode, readFingerprintCode } from "../../../lib/comparison/verificationCode";
import { sharingStatus, type PublicationStatus } from "../../../lib/comparison/sharingStatus";
import { initialScope } from "../GrantEditor";
import type { Link } from "../../../lib/api/comparison";
it("reads only the exact public-device QR format, rejecting URLs, other protocols and partial fingerprints", () => {
  const fingerprint = "ab".repeat(32);
  expect(readFingerprintCode(fingerprintCode(fingerprint))).toBe(fingerprint);
  for (const bad of [
    fingerprint,
    "https://example.test/" + fingerprintCode(fingerprint),
    "travstats-e2e:v1:" + fingerprint,
    fingerprintCode(fingerprint) + "x",
    "travstats-e2e:v2:abc",
    "travstats-e2e:v2:" + "z".repeat(64),
  ])
    expect(() => readFingerprintCode(bad)).toThrow();
});
it("does not mistake a pending, stale, expired or revoked publication for a current share", () => {
  const grant = { audience: "", active: true, revision: 2, scope: initialScope(["flight"]) };
  const link: Link = {
    id: "l",
    channel: "c",
    label: "friend",
    origin: "local",
    confirmed: true,
    remoteConfirmed: true,
    code: "123456",
    grants: [grant],
  };
  const publication: PublicationStatus = {
    id: "p",
    linkId: "l",
    audience: "",
    revision: 2,
    ready: true,
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-02-01T00:00:00Z",
  };
  const now = Date.parse("2026-01-15T00:00:00Z");
  expect(sharingStatus(link, grant, [publication], now).state).toBe("published");
  expect(sharingStatus(link, grant, [{ ...publication, ready: false }], now).state).toBe(
    "unpublished"
  );
  expect(sharingStatus(link, grant, [{ ...publication, revision: 1 }], now).state).toBe(
    "unpublished"
  );
  expect(
    sharingStatus(link, grant, [{ ...publication, audience: "another-group" }], now).state
  ).toBe("unpublished");
  expect(sharingStatus(link, { ...grant, active: false }, [publication], now).state).toBe(
    "revoked"
  );
  expect(sharingStatus(link, grant, [publication], Date.parse(publication.expiresAt)).state).toBe(
    "expired"
  );
});
