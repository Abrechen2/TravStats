import { afterEach, describe, expect, it } from "vitest";
import { MAX_HANDOFF_FRAGMENT } from "../bahnBookmarklet";
import {
  decodeBahnHandoff,
  pendingBahnHandoffPath,
  stashBahnHandoff,
  takeStashedBahnHandoff,
} from "../bahnHandoff";

/** A recon in the HAFAS shape; invented day and train number. */
const RECON =
  "¶HKI¶T$A=1@O=Augsburg Hbf@L=8000013@a=128@$A=1@O=München Hbf@L=8000261@a=128@" +
  "$202611030808$202611030854$RB 57099$$1$$$$$$¶KC¶";

const fragment = (payload: unknown): string => `#d=${encodeURIComponent(JSON.stringify(payload))}`;

describe("decodeBahnHandoff (forgejo#204)", () => {
  it("reads the answer the bookmarklet wrote, unknown fields dropped", () => {
    const decoded = decodeBahnHandoff(
      fragment({
        v: 1,
        answer: { hinfahrtRecon: RECON, klasse: "KLASSE_2", reisende: [{ alter: 30 }] },
        extra: "ignored",
      })
    );
    expect(decoded).toEqual({
      kind: "answer",
      answer: { hinfahrtRecon: RECON, klasse: "KLASSE_2" },
    });
  });

  it("keeps markup as inert text — it is only ever sent on, never rendered", () => {
    const decoded = decodeBahnHandoff(
      fragment({ v: 1, answer: { hinfahrtRecon: "<img src=x onerror=alert(1)>" } })
    );
    expect(decoded).toEqual({
      kind: "answer",
      answer: { hinfahrtRecon: "<img src=x onerror=alert(1)>" },
    });
  });

  it("names a tampered or foreign fragment as damaged", () => {
    expect(decodeBahnHandoff("#d=%7Bnot-json")).toEqual({ kind: "failed", reason: "damaged" });
    expect(decodeBahnHandoff(fragment({ v: 2, answer: { hinfahrtRecon: RECON } }))).toMatchObject({
      reason: "damaged",
    });
    expect(decodeBahnHandoff(fragment({ v: 1, answer: {} }))).toMatchObject({
      reason: "damaged",
    });
    expect(decodeBahnHandoff(fragment({ v: 1, answer: { hinfahrtRecon: 42 } }))).toMatchObject({
      reason: "damaged",
    });
    expect(
      decodeBahnHandoff(
        fragment({
          v: 1,
          answer: {
            verbindungsAbschnitte: [{ abfahrtsOrt: "x".repeat(121) }],
          },
        })
      )
    ).toMatchObject({ reason: "damaged" });
    expect(
      decodeBahnHandoff(
        fragment({
          v: 1,
          answer: { verbindungsAbschnitte: Array.from({ length: 31 }, () => ({})) },
        })
      )
    ).toMatchObject({ reason: "damaged" });
  });

  it("refuses an oversized fragment before decoding it", () => {
    expect(decodeBahnHandoff(`#d=${"a".repeat(MAX_HANDOFF_FRAGMENT)}`)).toEqual({
      kind: "failed",
      reason: "tooLarge",
    });
    expect(
      decodeBahnHandoff(fragment({ v: 1, answer: { hinfahrtRecon: "x".repeat(20_001) } }))
    ).toMatchObject({ reason: "damaged" });
  });

  it("passes the bookmarklet's own failure codes on, and only those", () => {
    expect(decodeBahnHandoff("#e=blocked")).toEqual({ kind: "failed", reason: "blocked" });
    expect(decodeBahnHandoff("#e=noVbid")).toEqual({ kind: "failed", reason: "noVbid" });
    expect(decodeBahnHandoff("#e=%3Cscript%3E")).toEqual({ kind: "failed", reason: "damaged" });
    expect(decodeBahnHandoff("#e=toString")).toEqual({ kind: "failed", reason: "damaged" });
  });

  it("says nothing arrived when the page is opened bare", () => {
    expect(decodeBahnHandoff("")).toEqual({ kind: "failed", reason: "empty" });
    expect(decodeBahnHandoff("#x=1")).toEqual({ kind: "failed", reason: "empty" });
  });
});

describe("the hand-over waiting through a login", () => {
  afterEach(() => sessionStorage.clear());

  it("is kept, sends the login's landing to the hand-over page, and is read once", () => {
    stashBahnHandoff("#e=blocked", 1_000);
    expect(pendingBahnHandoffPath(2_000)).toBe("/rail/from-bahn");
    expect(takeStashedBahnHandoff(2_000)).toBe("#e=blocked");
    expect(takeStashedBahnHandoff(2_000)).toBeNull();
    expect(pendingBahnHandoffPath(2_000)).toBeNull();
  });

  it("is dropped after ten minutes", () => {
    stashBahnHandoff("#e=blocked", 0);
    expect(pendingBahnHandoffPath(10 * 60 * 1000 + 1)).toBeNull();
    expect(takeStashedBahnHandoff(10 * 60 * 1000 + 1)).toBeNull();
  });

  it("stores nothing for a bare address", () => {
    stashBahnHandoff("", 0);
    expect(pendingBahnHandoffPath(0)).toBeNull();
  });
});
