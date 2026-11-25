import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * A restore that dies between installing the archive's key and the end of the
 * dump replay leaves key file and rows disagreeing. Before: nothing recorded
 * that the swap had started, so a restart came up with whichever key the file
 * held and no word about it — and a second key restore would have piled a new
 * swap onto the unfinished one. Now the swap writes a marker first, removes it
 * only when key and rows agree again, and a marker found at start is logged,
 * raised on the readiness page and blocks the next key restore. The key file
 * is never changed by any of this.
 */

const KEY_OLD = "a1".repeat(32);
const KEY_NEW = "b2".repeat(32);

type Modules = {
  marker: typeof import("../keySwapMarker");
  swap: typeof import("../restoreRecoveryKey");
  encryption: typeof import("../../../utils/encryption");
  logger: typeof import("../../../utils/logger");
};

describe("an interrupted key swap", () => {
  const originalEnv = { ...process.env };
  let secretsDir: string;
  let keyFile: string;
  let m: Modules;

  async function boot(keyHex: string): Promise<Modules> {
    fs.writeFileSync(keyFile, keyHex, { mode: 0o600 });
    delete process.env.ENCRYPTION_KEY;
    jest.resetModules();
    return {
      marker: await import("../keySwapMarker"),
      swap: await import("../restoreRecoveryKey"),
      encryption: await import("../../../utils/encryption"),
      logger: await import("../../../utils/logger"),
    };
  }

  const swapFor = (archiveKeyHex: string, previousKeyHex: string) => ({
    archiveKeyHex,
    previousKeyHex,
    requestedBy: null,
    previousKeyCopy: m.swap.previousKeyCopyPath(),
    identityPlain: { federationPrivateKey: null, pushInstanceSecret: null },
  });

  beforeEach(async () => {
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "key-swap-marker-"));
    keyFile = path.join(secretsDir, "encryption.key");
    process.env.SECRETS_DIR = secretsDir;
    m = await boot(KEY_OLD);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(secretsDir, { recursive: true, force: true });
  });

  it("a swap that never finished is found at start, logged, and the key file is left alone", async () => {
    const swap = swapFor(KEY_NEW, KEY_OLD);
    m.swap.installArchiveKey(swap);
    // The process dies here: no revert, no finish.
    m = await boot(fs.readFileSync(keyFile, "utf-8"));
    const errors: string[] = [];
    const spy = jest
      .spyOn(m.logger.default, "error")
      .mockImplementation(((obj: unknown) => void errors.push(JSON.stringify(obj))) as never);
    try {
      const found = m.marker.reconcileKeySwapAtBoot();
      expect(found).toMatchObject({
        previousKeyCopy: swap.previousKeyCopy,
        previousKeyCopyExists: true,
        inForce: "archive",
      });
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).toContain("restore_key_swap_interrupted");
    // Never a key in the log, and never a silent pick: the file still holds what it held.
    expect(errors.join("\n").toLowerCase()).not.toContain(KEY_NEW);
    expect(errors.join("\n").toLowerCase()).not.toContain(KEY_OLD);
    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_NEW);
    expect(fs.readFileSync(swap.previousKeyCopy, "utf-8")).toBe(KEY_OLD);
  });

  it("refuses a second key restore while the first swap is unresolved", () => {
    m.swap.installArchiveKey(swapFor(KEY_NEW, KEY_OLD));
    const fingerprint = m.encryption.encryptionKeyFingerprintFor(KEY_OLD);
    expect(() => m.swap.resolveArchiveRecoveryKey(KEY_OLD, fingerprint)).toThrow(
      expect.objectContaining({ code: "RESTORE_KEY_SWAP_UNRESOLVED" })
    );
  });

  it("a finished swap leaves no marker, and nothing is reported at start", async () => {
    const swap = swapFor(KEY_NEW, KEY_OLD);
    m.swap.installArchiveKey(swap);
    await m.swap.finishKeySwap(swap);
    expect(m.marker.readInterruptedKeySwap()).toBeNull();
    expect(m.marker.reconcileKeySwapAtBoot()).toBeNull();
    // The old-key copy stays: it decrypts the safety backup.
    expect(fs.existsSync(swap.previousKeyCopy)).toBe(true);
  });

  it("a failed replay that put the old key back leaves no marker", () => {
    const swap = swapFor(KEY_NEW, KEY_OLD);
    m.swap.installArchiveKey(swap);
    m.swap.revertKeySwap(swap);
    expect(fs.readFileSync(keyFile, "utf-8")).toBe(KEY_OLD);
    expect(m.marker.readInterruptedKeySwap()).toBeNull();
  });

  it("an unreadable marker still counts as an interrupted swap", () => {
    fs.writeFileSync(m.marker.keySwapMarkerPath(), "{not json");
    expect(m.marker.readInterruptedKeySwap()).toMatchObject({ previousKeyCopyExists: false });
  });
});
