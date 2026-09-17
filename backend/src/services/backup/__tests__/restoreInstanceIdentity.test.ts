import { prisma } from "../../../db";
import { readInstanceIdentity, restoreInstanceIdentity } from "../backupRestore";

/**
 * forgejo#115. A dump carries `admin_settings` like every other table, so a
 * restore adopts the identity of whichever instance produced it. On 2026-09-05
 * prod was rebuilt from an RC dump and inherited the RC's three URLs; for the
 * next three days every pairing QR prod printed sent the phone to a different
 * server, where the code was unknown and the app reported it expired. Nothing
 * about the running instance looked wrong, which is why it took until
 * 2026-09-08 to find.
 *
 * These tests drive the before/after pairing directly rather than the whole
 * restore — the psql run between them is not what was broken.
 */
describe("restoreInstanceIdentity", () => {
  const OWN = {
    frontendUrl: "https://own.example",
    publicUrl: "https://own.example",
    lanUrl: "http://192.168.0.10:3010",
    webauthnRpId: "own.example",
    webauthnOrigins: ["https://own.example"],
  };

  const FROM_THE_ARCHIVE = {
    frontendUrl: "https://someone-else.example",
    publicUrl: "https://someone-else.example",
    lanUrl: "http://192.168.0.99:3010",
    webauthnRpId: "someone-else.example",
    webauthnOrigins: ["https://someone-else.example"],
  };

  const write = async (values: typeof OWN): Promise<void> => {
    const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    await prisma.adminSettings.update({ where: { id: row.id }, data: values });
  };

  const read = async (): Promise<typeof OWN> => {
    const row = await prisma.adminSettings.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: {
        frontendUrl: true,
        publicUrl: true,
        lanUrl: true,
        webauthnRpId: true,
        webauthnOrigins: true,
      },
    });
    return row as typeof OWN;
  };

  // These four columns are instance-wide, so the file must hand them back
  // exactly as it found them — nulling them "to the default" would quietly
  // reconfigure whatever suite runs next.
  let original: typeof OWN;

  beforeAll(async () => {
    original = await read();
  });

  afterAll(async () => {
    await write(original);
    await prisma.$disconnect();
  });

  it("puts this instance back on its own address after a foreign dump", async () => {
    await write(OWN);
    const before = await readInstanceIdentity();

    // What psql does to the row.
    await write(FROM_THE_ARCHIVE);

    await restoreInstanceIdentity(before);

    expect(await read()).toEqual(OWN);
  });

  it("keeps the relying-party id, which a foreign one would not merely degrade", async () => {
    await write(OWN);
    const before = await readInstanceIdentity();
    await write(FROM_THE_ARCHIVE);

    await restoreInstanceIdentity(before);

    const after = await read();
    expect(after.webauthnRpId).toBe("own.example");
    expect(after.webauthnOrigins).toEqual(["https://own.example"]);
  });

  it("restores a cleared field as cleared, so the instance falls back to its own ENV", async () => {
    await write({
      frontendUrl: null,
      publicUrl: null,
      lanUrl: null,
      webauthnRpId: null,
      webauthnOrigins: [],
    } as unknown as typeof OWN);
    const before = await readInstanceIdentity();

    await write(FROM_THE_ARCHIVE);

    await restoreInstanceIdentity(before);

    const after = await read();
    expect(after.publicUrl).toBeNull();
    expect(after.webauthnOrigins).toEqual([]);
  });

  it("leaves the row alone when the archive agreed with it", async () => {
    await write(OWN);
    const before = await readInstanceIdentity();

    await restoreInstanceIdentity(before);

    expect(await read()).toEqual(OWN);
  });
});
