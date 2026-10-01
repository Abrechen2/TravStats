import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

/**
 * `travstats-push v1` — seals one notification for exactly one phone.
 *
 * X25519 with a fresh ephemeral key per message, HKDF-SHA256 (salt =
 * ephemeral public key ‖ device public key, info = "travstats-push v1"),
 * ChaCha20-Poly1305 with a 12-byte nonce and the info string as AAD. Wire:
 * base64url(ephemeralPublic(32) ‖ nonce(12) ‖ ciphertext ‖ tag(16)).
 *
 * Chosen so the phone opens it without extra libraries: Apple CryptoKit in
 * the iOS notification extension, @noble on Android. The relay, Cloudflare,
 * Apple and Google only ever see the wire string. Shared test vectors:
 * push-vectors.json (copied verbatim into the Companion repo).
 */
const INFO = Buffer.from("travstats-push v1");

/** PKCS#8 DER header for a raw 32-byte X25519 private key (RFC 8410). */
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function rawBytes(b64u: string, length: number, what: string): Buffer {
  const raw = Buffer.from(b64u, "base64url");
  if (raw.length !== length) throw new Error(`${what} must be ${length} bytes`);
  return raw;
}

function privateKeyFromRaw(d: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, d]),
    format: "der",
    type: "pkcs8",
  });
}

function rawPublicKey(key: KeyObject): Buffer {
  return Buffer.from(key.export({ format: "jwk" }).x as string, "base64url");
}

/** Deterministic form for tests and the shared vectors; production uses {@link sealForDevice}. */
export function sealWith(
  devicePublicKeyB64u: string,
  plaintext: string,
  ephemeralPrivateKeyB64u: string,
  nonce: Buffer
): string {
  const deviceRaw = rawBytes(devicePublicKeyB64u, 32, "device public key");
  if (nonce.length !== 12) throw new Error("nonce must be 12 bytes");
  const devicePublic = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: devicePublicKeyB64u },
    format: "jwk",
  });
  const ephemeralPrivate = privateKeyFromRaw(
    rawBytes(ephemeralPrivateKeyB64u, 32, "ephemeral private key")
  );
  const ephemeralPublic = rawPublicKey(createPublicKey(ephemeralPrivate));

  const shared = diffieHellman({ privateKey: ephemeralPrivate, publicKey: devicePublic });
  const key = Buffer.from(
    hkdfSync("sha256", shared, Buffer.concat([ephemeralPublic, deviceRaw]), INFO, 32)
  );
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  cipher.setAAD(INFO, { plaintextLength: Buffer.byteLength(plaintext, "utf8") });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([ephemeralPublic, nonce, ciphertext, cipher.getAuthTag()]).toString(
    "base64url"
  );
}

/** Seal `plaintext` for the device whose X25519 public key (base64url, 32 bytes) is given. */
export function sealForDevice(devicePublicKeyB64u: string, plaintext: string): string {
  const ephemeral = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" }).d as string;
  return sealWith(devicePublicKeyB64u, plaintext, ephemeral, randomBytes(12));
}
