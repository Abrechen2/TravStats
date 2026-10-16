/** Browser-only sealed publications. Protocol v2; see docs/FEDERATION_E2E.md. */
export interface PublicDevice {
  id: string;
  name: string;
  encryption: string;
  signing: string;
  fingerprint: string;
}
export interface DeviceKeys {
  public: PublicDevice;
  encryption: CryptoKey;
  signing: CryptoKey;
}
export interface Context {
  version: 2;
  id: string;
  channel: string;
  audience: string;
  revision: number;
  sender: string;
  createdAt: string;
  expiresAt: string;
}
export interface Manifest {
  context: Context;
  ephemeral: string;
  recipients: Array<{ fingerprint: string; iv: string; key: string }>;
  digests: string[];
  indexStart: number;
  indexCount: number;
  signature: string;
}
const encoder = new TextEncoder();
export const encode = (s: string) => encoder.encode(s);
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
export function base64(bytes: Uint8Array<ArrayBuffer>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export const unbase64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
export const fingerprintOf = (d: Pick<PublicDevice, "encryption" | "signing">) =>
  digest(encode(canonical({ encryption: d.encryption, signing: d.signing })));
export async function checkDevice(d: PublicDevice) {
  if ((await fingerprintOf(d)) !== d.fingerprint) throw Error("E2E_KEY_MISMATCH");
  await crypto.subtle.importKey(
    "spki",
    unbase64(d.encryption),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  await crypto.subtle.importKey(
    "spki",
    unbase64(d.signing),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}
const aad = (context: Context, part: number) =>
  encode(canonical({ protocol: "travstats-e2e-v2", context, part }));
async function wrapKey(
  privateKey: CryptoKey,
  publicKey: string,
  context: Context,
  recipient: string
) {
  const pub = await crypto.subtle.importKey(
    "spki",
    unbase64(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encode(context.id),
      info: encode(canonical({ protocol: "travstats-e2e-wrap-v2", context, recipient })),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
export async function createPublication(
  device: DeviceKeys,
  context: Context,
  recipients: PublicDevice[]
) {
  if (
    context.sender !== device.public.fingerprint ||
    !recipients.length ||
    new Set(recipients.map((d) => d.fingerprint)).size !== recipients.length
  )
    throw Error("E2E_RECIPIENTS");
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const wrapped = [];
  for (const recipient of recipients) {
    await checkDevice(recipient);
    const wrapping = await wrapKey(
      ephemeral.privateKey,
      recipient.encryption,
      context,
      recipient.fingerprint
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    wrapped.push({
      fingerprint: recipient.fingerprint,
      iv: base64(iv),
      key: base64(
        new Uint8Array(
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: aad(context, -1), tagLength: 128 },
            wrapping,
            raw
          )
        )
      ),
    });
  }
  raw.fill(0);
  const unsigned = {
    context,
    ephemeral: base64(new Uint8Array(await crypto.subtle.exportKey("spki", ephemeral.publicKey))),
    recipients: wrapped,
    digests: [] as string[],
  };
  return {
    async chunk(plaintext: Uint8Array<ArrayBuffer>) {
      const part = unsigned.digests.length;
      if (part >= 8192 || plaintext.length > 256 * 1024) throw Error("E2E_SIZE");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad(context, part), tagLength: 128 },
          key,
          plaintext
        )
      );
      const bytes = new Uint8Array(iv.length + encrypted.length);
      bytes.set(iv);
      bytes.set(encrypted, iv.length);
      unsigned.digests.push(await digest(bytes));
      return { part, bytes: base64(bytes) };
    },
    async finish(indexStart = 0, indexCount = unsigned.digests.length): Promise<Manifest> {
      if (!unsigned.digests.length) throw Error("E2E_EMPTY");
      const complete = { ...unsigned, indexStart, indexCount };
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        device.signing,
        encode(canonical(complete))
      );
      return {
        ...complete,
        digests: [...unsigned.digests],
        signature: base64(new Uint8Array(signature)),
      };
    },
  };
}
export async function openPublication(
  device: DeviceKeys,
  sender: PublicDevice,
  manifest: Manifest,
  expected: { audience: string; channel?: string },
  now = Date.now()
) {
  await checkDevice(sender);
  const { signature, ...unsigned } = manifest;
  const c = manifest.context;
  if (
    !Number.isInteger(manifest.indexStart) ||
    !Number.isInteger(manifest.indexCount) ||
    manifest.indexStart < 0 ||
    manifest.indexCount < 1 ||
    manifest.indexStart + manifest.indexCount !== manifest.digests.length ||
    c.version !== 2 ||
    c.sender !== sender.fingerprint ||
    c.audience !== expected.audience ||
    (expected.channel && c.channel !== expected.channel) ||
    !Number.isFinite(Date.parse(c.expiresAt)) ||
    Date.parse(c.expiresAt) <= now ||
    Date.parse(c.createdAt) > now + 300_000 ||
    !manifest.digests.length ||
    manifest.digests.length > 8192
  )
    throw Error("E2E_CONTEXT");
  const signing = await crypto.subtle.importKey(
    "spki",
    unbase64(sender.signing),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      signing,
      unbase64(signature),
      encode(canonical(unsigned))
    ))
  )
    throw Error("E2E_SIGNATURE");
  const recipient = manifest.recipients.find((r) => r.fingerprint === device.public.fingerprint);
  if (!recipient) throw Error("E2E_RECIPIENT");
  const wrapping = await wrapKey(device.encryption, manifest.ephemeral, c, recipient.fingerprint);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(recipient.iv), additionalData: aad(c, -1), tagLength: 128 },
    wrapping,
    unbase64(recipient.key)
  );
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  new Uint8Array(raw).fill(0);
  return async (part: number, bytes: string) => {
    const encrypted = unbase64(bytes);
    if (
      !Number.isInteger(part) ||
      part < 0 ||
      part >= manifest.digests.length ||
      encrypted.length > 262172 ||
      (await digest(encrypted)) !== manifest.digests[part]
    )
      throw Error("E2E_CHUNK");
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: encrypted.slice(0, 12),
          additionalData: aad(c, part),
          tagLength: 128,
        },
        key,
        encrypted.slice(12)
      )
    );
  };
}
export async function generateDevice(name: string) {
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const sign = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKeys = {
    encryption: base64(new Uint8Array(await crypto.subtle.exportKey("spki", enc.publicKey))),
    signing: base64(new Uint8Array(await crypto.subtle.exportKey("spki", sign.publicKey))),
  };
  const pub = {
    ...publicKeys,
    id: crypto.randomUUID(),
    name,
    fingerprint: await fingerprintOf(publicKeys),
  };
  const plaintext = {
    public: pub,
    encryption: await crypto.subtle.exportKey("jwk", enc.privateKey),
    signing: await crypto.subtle.exportKey("jwk", sign.privateKey),
  };
  const recoveryCode = base64(crypto.getRandomValues(new Uint8Array(32)));
  const recoveryKey = await crypto.subtle.importKey(
    "raw",
    unbase64(recoveryCode),
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const backup = {
    version: 2,
    iv: base64(iv),
    bytes: base64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: encode("travstats-device-backup-v2") },
          recoveryKey,
          encode(JSON.stringify(plaintext))
        )
      )
    ),
  };
  return { device: await importDevice(plaintext), backup, recoveryCode };
}
async function importDevice(value: {
  public: PublicDevice;
  encryption: JsonWebKey;
  signing: JsonWebKey;
}): Promise<DeviceKeys> {
  await checkDevice(value.public);
  // Importing the private keys as public JWKs proves the advertised identity matches the backup.
  for (const field of ["encryption", "signing"] as const) {
    const { d: _private, ...pub } = value[field];
    void _private;
    delete pub.key_ops;
    const key = await crypto.subtle.importKey(
      "jwk",
      pub,
      { name: field === "encryption" ? "ECDH" : "ECDSA", namedCurve: "P-256" },
      true,
      field === "encryption" ? [] : ["verify"]
    );
    if (base64(new Uint8Array(await crypto.subtle.exportKey("spki", key))) !== value.public[field])
      throw Error("E2E_BACKUP_IDENTITY");
  }
  return {
    public: value.public,
    encryption: await crypto.subtle.importKey(
      "jwk",
      value.encryption,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    ),
    signing: await crypto.subtle.importKey(
      "jwk",
      value.signing,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    ),
  };
}
export async function recoverDevice(
  backup: { version: number; iv: string; bytes: string },
  code: string
) {
  if (backup.version !== 2 || backup.bytes.length > 20000) throw Error("E2E_BACKUP");
  const key = await crypto.subtle.importKey("raw", unbase64(code.trim()), "AES-GCM", false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(backup.iv),
      additionalData: encode("travstats-device-backup-v2"),
    },
    key,
    unbase64(backup.bytes)
  );
  return importDevice(JSON.parse(new TextDecoder().decode(plain)));
}
