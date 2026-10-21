/**
 * Envelope version 2 (spec 2026-10-20 §4): `purpose` is a signed field, so a packet signed for one
 * protocol never verifies for the other. The vectors were produced outside `envelope.ts`; they
 * pin the exact signed bytes — version 1's are what every server before version 2 signs — and
 * which route reads which envelope.
 */
import { createPrivateKey } from "crypto";
import {
  COMPARISON_ACCEPTS,
  TRIP_SHARE_ACCEPTS,
  envelope,
  signingBytes,
  verifyEnvelope,
  type Acceptance,
  type EnvelopePurpose,
} from "../envelope";
import { PeerRefusal } from "../refusal";
import vectors from "./envelope.vectors.json";

const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(vectors.seedHex, "hex"),
  ]),
  format: "der",
  type: "pkcs8",
});
const ACCEPTANCES: Record<EnvelopePurpose, Acceptance> = {
  "comparison/1": COMPARISON_ACCEPTS,
  "trip-share/1": TRIP_SHARE_ACCEPTS,
};

describe.each(vectors.cases)("envelope vector $name", (vector) => {
  const { signature, ...unsigned } = vector.envelope;

  it("signs exactly the canonical bytes", () => {
    expect(signingBytes(unsigned as never).toString()).toBe(vector.signedBytes);
  });

  it("is reproduced by envelope() with the same fields", () => {
    jest.spyOn(Date, "now").mockReturnValue(vector.envelope.time);
    const purpose = "purpose" in unsigned ? (unsigned.purpose as EnvelopePurpose) : undefined;
    const made = envelope(
      JSON.parse(vector.envelope.body),
      vector.envelope.destination,
      { origin: vector.envelope.origin, key },
      vector.envelope.nonce,
      purpose
    );
    jest.restoreAllMocks();
    expect(made).toEqual(vector.envelope);
    expect(made.signature).toBe(signature);
  });

  it.each(Object.keys(ACCEPTANCES) as EnvelopePurpose[])(
    "is read by the %s route only if listed",
    (purpose) => {
      const read = () =>
        verifyEnvelope(
          vector.envelope,
          vectors.publicKey,
          vector.envelope.destination,
          vector.envelope.time,
          ACCEPTANCES[purpose]
        );
      if (vector.readBy.includes(purpose)) expect(read()).toEqual(vector.envelope);
      else {
        expect(read).toThrow(PeerRefusal);
        expect(() => read()).toThrow(expect.objectContaining({ kind: "wrong-purpose" }));
      }
    }
  );
});

describe("purpose is signed", () => {
  const v2 = vectors.cases.find((c) => c.name === "v2-comparison")!.envelope;

  it("refuses a purpose rewritten after signing as a bad signature, not as a match", () => {
    const forged = { ...v2, purpose: "trip-share/1" };
    expect(() =>
      verifyEnvelope(forged, vectors.publicKey, v2.destination, v2.time, TRIP_SHARE_ACCEPTS)
    ).toThrow(expect.objectContaining({ kind: "bad-signature" }));
  });

  it("refuses a version-1 signature presented as version 2", () => {
    const v1 = vectors.cases.find((c) => c.name === "v1")!.envelope;
    const lifted = { v: 2, purpose: "comparison/1", ...v1 };
    expect(() =>
      verifyEnvelope(lifted, vectors.publicKey, v1.destination, v1.time, COMPARISON_ACCEPTS)
    ).toThrow(expect.objectContaining({ kind: "bad-signature" }));
  });

  it("refuses an unknown purpose and an unknown version at parse", () => {
    expect(() =>
      verifyEnvelope({ ...v2, purpose: "travel/1" }, vectors.publicKey, v2.destination, v2.time)
    ).toThrow();
    expect(() =>
      verifyEnvelope({ ...v2, v: 3 }, vectors.publicKey, v2.destination, v2.time)
    ).toThrow();
  });
});
