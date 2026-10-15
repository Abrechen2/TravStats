import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  generateDevice,
  recoverDevice,
  createPublication,
  openPublication,
  encode,
  base64,
  type Context,
} from "../../../lib/comparison/crypto";
beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
const context = (sender: string): Context => ({
  version: 2,
  id: crypto.randomUUID(),
  channel: crypto.randomUUID(),
  audience: "",
  revision: 1,
  sender,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});
describe("device-to-device sealed travel publications", () => {
  it("allows two approved recipients to decrypt while the relay and a stranger cannot", async () => {
    const [a, b, c, stranger] = await Promise.all(["a", "b", "c", "stranger"].map(generateDevice));
    const ctx = context(a.device.public.fingerprint),
      publication = await createPublication(a.device, ctx, [b.device.public, c.device.public]);
    const chunk = await publication.chunk(encode("private journey with photos")),
      manifest = await publication.finish();
    expect(JSON.stringify({ manifest, chunk })).not.toContain("private journey");
    for (const recipient of [b, c]) {
      const decrypt = await openPublication(recipient.device, a.device.public, manifest, {
        audience: "",
        channel: ctx.channel,
      });
      expect(new TextDecoder().decode(await decrypt(0, chunk.bytes))).toBe(
        "private journey with photos"
      );
    }
    await expect(
      openPublication(stranger.device, a.device.public, manifest, { audience: "" })
    ).rejects.toThrow("E2E_RECIPIENT");
    await expect(crypto.subtle.exportKey("jwk", a.device.signing)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", b.device.encryption)).rejects.toThrow();
  });
  it("rejects substituted device keys, tampered manifests, chunks and wrong audiences", async () => {
    const [a, b, mallory] = await Promise.all(["a", "b", "m"].map(generateDevice));
    const ctx = context(a.device.public.fingerprint),
      publication = await createPublication(a.device, ctx, [b.device.public]);
    const one = await publication.chunk(encode("one")),
      two = await publication.chunk(encode("two")),
      manifest = await publication.finish();
    await expect(
      openPublication(
        b.device,
        { ...a.device.public, signing: mallory.device.public.signing },
        manifest,
        { audience: "" }
      )
    ).rejects.toThrow("E2E_KEY_MISMATCH");
    await expect(
      openPublication(
        b.device,
        a.device.public,
        { ...manifest, ephemeral: mallory.device.public.encryption },
        { audience: "" }
      )
    ).rejects.toThrow("E2E_SIGNATURE");
    await expect(
      openPublication(b.device, a.device.public, manifest, { audience: "another group" })
    ).rejects.toThrow("E2E_CONTEXT");
    await expect(
      openPublication(b.device, a.device.public, manifest, {
        audience: "",
        channel: crypto.randomUUID(),
      })
    ).rejects.toThrow("E2E_CONTEXT");
    const decrypt = await openPublication(b.device, a.device.public, manifest, { audience: "" });
    await expect(decrypt(0, two.bytes)).rejects.toThrow("E2E_CHUNK");
    await expect(decrypt(1, one.bytes)).rejects.toThrow("E2E_CHUNK");
    await expect(decrypt(0, base64(encode("replaced ciphertext")))).rejects.toThrow("E2E_CHUNK");
    await expect(
      openPublication(
        b.device,
        a.device.public,
        { ...manifest, digests: manifest.digests.slice(0, 1) },
        { audience: "" }
      )
    ).rejects.toThrow();
    await expect(
      openPublication(b.device, a.device.public, manifest, { audience: "" }, Date.now() + 1000000)
    ).rejects.toThrow("E2E_CONTEXT");
  });
  it("uses a new key for each publication and excludes removed devices", async () => {
    const [a, b, c] = await Promise.all(["a", "b", "c"].map(generateDevice));
    const first = await createPublication(a.device, context(a.device.public.fingerprint), [
      b.device.public,
      c.device.public,
    ]);
    const second = await createPublication(a.device, context(a.device.public.fingerprint), [
      b.device.public,
    ]);
    await first.chunk(encode("same"));
    await second.chunk(encode("same"));
    const old = await first.finish(),
      next = await second.finish();
    expect(old.ephemeral).not.toBe(next.ephemeral);
    expect(old.digests).not.toEqual(next.digests);
    await expect(
      openPublication(c.device, a.device.public, next, { audience: "" })
    ).rejects.toThrow("E2E_RECIPIENT");
  });
  it("restores only with both encrypted backup and recovery code", async () => {
    const generated = await generateDevice("phone");
    const restored = await recoverDevice(generated.backup, generated.recoveryCode);
    expect(restored.public).toEqual(generated.device.public);
    expect(JSON.stringify(generated.backup)).not.toContain(generated.device.public.fingerprint);
    await expect(
      recoverDevice(generated.backup, base64(crypto.getRandomValues(new Uint8Array(32))))
    ).rejects.toThrow();
    const publication = await createPublication(restored, context(restored.public.fingerprint), [
      generated.device.public,
    ]);
    const part = await publication.chunk(encode("after recovery")),
      manifest = await publication.finish();
    const decrypt = await openPublication(generated.device, restored.public, manifest, {
      audience: "",
    });
    expect(new TextDecoder().decode(await decrypt(0, part.bytes))).toBe("after recovery");
  });
});
