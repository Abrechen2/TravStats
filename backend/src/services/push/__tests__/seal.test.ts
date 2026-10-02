import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from "node:crypto";

import vectors from "../push-vectors.json";
import { sealForDevice, sealWith } from "../seal";

/**
 * `travstats-push v1` (Companion spec §3.1): X25519 + HKDF-SHA256 +
 * ChaCha20-Poly1305. The `open` below is written independently of seal.ts —
 * it is what the phone does (CryptoKit in the iOS extension, @noble on
 * Android) — and push-vectors.json is the shared fixture all three pass.
 */
const INFO = Buffer.from("travstats-push v1");
const b64u = (b: Buffer) => b.toString("base64url");

function devicePair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return {
    priv: privateKey.export({ format: "jwk" }).d as string,
    pub: publicKey.export({ format: "jwk" }).x as string,
  };
}

function open(devicePriv: string, devicePub: string, wire: string): string {
  const raw = Buffer.from(wire, "base64url");
  const eph = raw.subarray(0, 32);
  const nonce = raw.subarray(32, 44);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(44, raw.length - 16);
  const shared = diffieHellman({
    privateKey: createPrivateKey({
      key: { kty: "OKP", crv: "X25519", d: devicePriv, x: devicePub },
      format: "jwk",
    }),
    publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(eph) }, format: "jwk" }),
  });
  const salt = Buffer.concat([eph, Buffer.from(devicePub, "base64url")]);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, INFO, 32));
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAAD(INFO);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

describe("travstats-push v1", () => {
  it("round-trips through what the phone does", () => {
    const device = devicePair();
    const message = JSON.stringify({
      v: 1,
      type: "flight.changed",
      title: "LH 712: neues Gate",
      body: "B12 statt A26",
    });
    expect(open(device.priv, device.pub, sealForDevice(device.pub, message))).toBe(message);
  });

  it("uses a fresh ephemeral key and nonce every time", () => {
    const device = devicePair();
    expect(sealForDevice(device.pub, "x")).not.toBe(sealForDevice(device.pub, "x"));
  });

  it("matches every shared vector byte for byte", () => {
    expect(vectors.valid.length).toBeGreaterThanOrEqual(2);
    for (const v of vectors.valid) {
      expect(
        sealWith(
          v.devicePublicKey,
          v.plaintext,
          v.ephemeralPrivateKey,
          Buffer.from(v.nonce, "base64url")
        )
      ).toBe(v.wire);
      expect(open(v.devicePrivateKey, v.devicePublicKey, v.wire)).toBe(v.plaintext);
    }
  });

  it("refuses the tampered vector", () => {
    const t = vectors.tampered;
    expect(() => open(t.devicePrivateKey, t.devicePublicKey, t.wire)).toThrow();
  });

  it("rejects a device key that is not 32 bytes", () => {
    expect(() => sealForDevice(b64u(Buffer.alloc(31)), "x")).toThrow(/32 bytes/);
  });

  it("rejects a nonce that is not 12 bytes", () => {
    const device = devicePair();
    const eph = devicePair().priv;
    expect(() => sealWith(device.pub, "x", eph, Buffer.alloc(11))).toThrow(/12 bytes/);
  });
});
