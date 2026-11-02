import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import {
  VOUCH_PREFIX,
  VouchRefused,
  canonicalVouch,
  claimedIssuer,
  signVouch,
  verifyVouch,
  vouchSubject,
  type Vouch,
} from "../vouch";

// A fixed key, so the vector below can never drift without a deliberate change of the format.
const seed = Buffer.alloc(32, 7);
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const pub = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();

const vouch: Vouch = {
  v: 1,
  iss: "https://guest.example",
  aud: "https://host.example",
  sub: "a".repeat(64),
  name: "Anna",
  invite: "11111111-1111-4111-8111-111111111111",
  nonce: "b".repeat(64),
  iat: 1_800_000_000,
  exp: 1_800_000_090,
};
const NOW = 1_800_000_030_000;

// Test vector: canonical JSON and the Ed25519 token over VOUCH_PREFIX + canonical.
const CANONICAL =
  '{"v":1,"iss":"https://guest.example","aud":"https://host.example","sub":"' +
  "a".repeat(64) +
  '","name":"Anna","invite":"11111111-1111-4111-8111-111111111111","nonce":"' +
  "b".repeat(64) +
  '","iat":1800000000,"exp":1800000090}';

describe("vouch", () => {
  it("signs the canonical JSON behind the domain prefix (test vector)", () => {
    expect(canonicalVouch(vouch)).toBe(CANONICAL);
    const token = signVouch(vouch, key);
    const [payload, signature] = token.split(".");
    expect(Buffer.from(payload, "base64url").toString()).toBe(CANONICAL);
    // Ed25519 is deterministic: the same bytes always give the same signature.
    expect(signature).toBe(
      sign(null, Buffer.from(VOUCH_PREFIX + CANONICAL), key).toString("base64url")
    );
    expect(signature).toBe(VECTOR_SIGNATURE);
    expect(verifyVouch(token, pub, "https://host.example", NOW)).toEqual(vouch);
  });

  it("refuses a vouch signed by any other key (a forged vouch)", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = signVouch(vouch, other);
    expect(() => verifyVouch(forged, pub, "https://host.example", NOW)).toThrow(
      expect.objectContaining({ fault: "bad-signature" })
    );
  });

  it("refuses a signature made without the domain prefix, so another protocol's packet is no vouch", () => {
    const bare = sign(null, Buffer.from(CANONICAL), key).toString("base64url");
    const token = `${Buffer.from(CANONICAL).toString("base64url")}.${bare}`;
    expect(() => verifyVouch(token, pub, "https://host.example", NOW)).toThrow(VouchRefused);
  });

  it("refuses a vouch meant for another host", () => {
    const token = signVouch(vouch, key);
    expect(() => verifyVouch(token, pub, "https://evil.example", NOW)).toThrow(
      expect.objectContaining({ fault: "wrong-audience" })
    );
  });

  it("refuses an expired vouch, one from the future and one that lives too long", () => {
    const token = signVouch(vouch, key);
    expect(() => verifyVouch(token, pub, "https://host.example", NOW + 600_000)).toThrow(
      expect.objectContaining({ fault: "expired" })
    );
    expect(() => verifyVouch(token, pub, "https://host.example", NOW - 600_000)).toThrow(
      expect.objectContaining({ fault: "expired" })
    );
    const long = signVouch({ ...vouch, exp: vouch.iat + 3600 }, key);
    expect(() => verifyVouch(long, pub, "https://host.example", NOW)).toThrow(
      expect.objectContaining({ fault: "too-long" })
    );
  });

  it("refuses a payload whose bytes are not the canonical spelling, even with a valid signature", () => {
    const spaced = JSON.stringify(JSON.parse(CANONICAL), null, 1);
    const signature = sign(null, Buffer.from(VOUCH_PREFIX + spaced), key).toString("base64url");
    const token = `${Buffer.from(spaced).toString("base64url")}.${signature}`;
    expect(() => verifyVouch(token, pub, "https://host.example", NOW)).toThrow(
      expect.objectContaining({ fault: "malformed" })
    );
  });

  it("refuses garbage, an extra field and a tampered payload", () => {
    for (const token of ["", "x", "a.b.c", "!!.??"])
      expect(() => verifyVouch(token, pub, "https://host.example", NOW)).toThrow(VouchRefused);
    const token = signVouch(vouch, key);
    const tampered = Buffer.from(CANONICAL.replace("Anna", "Bert")).toString("base64url");
    expect(() =>
      verifyVouch(`${tampered}.${token.split(".")[1]}`, pub, "https://host.example", NOW)
    ).toThrow(expect.objectContaining({ fault: "bad-signature" }));
  });

  it("reads the claimed issuer without believing it", () => {
    expect(claimedIssuer(signVouch(vouch, key))).toBe("https://guest.example");
  });

  it("gives one account a different pseudonym for every host", () => {
    const a = vouchSubject(key, "https://host.example", "user-1");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(vouchSubject(key, "https://host.example", "user-1"));
    expect(a).not.toBe(vouchSubject(key, "https://other.example", "user-1"));
    expect(a).not.toBe(vouchSubject(key, "https://host.example", "user-2"));
  });
});

const VECTOR_SIGNATURE =
  "NJ_7DgPPft9RQyyjZd8WGjoklLWzDfhnq9i8UfdLCBX62kk3zFefQVN1LUUtHF6MwHkO_3TFWRpptBa_4RZdDA";
