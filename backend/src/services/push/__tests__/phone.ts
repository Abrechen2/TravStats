import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from "node:crypto";

/**
 * Test-only stand-in for the phone: an X25519 key pair and the `open` the
 * Companion does (CryptoKit / @noble), written independently of seal.ts.
 */
const INFO = Buffer.from("travstats-push v1");

export function phoneKeys(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return {
    priv: privateKey.export({ format: "jwk" }).d as string,
    pub: publicKey.export({ format: "jwk" }).x as string,
  };
}

export function openOnPhone(devicePriv: string, devicePub: string, wire: string): string {
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
    publicKey: createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: eph.toString("base64url") },
      format: "jwk",
    }),
  });
  const salt = Buffer.concat([eph, Buffer.from(devicePub, "base64url")]);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, INFO, 32));
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAAD(INFO, { plaintextLength: ct.length });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
