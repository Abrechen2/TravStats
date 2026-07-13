import { getCachedLogo, putCachedLogo, logoCacheDir } from "../logoCache";
import fs from "fs";
import path from "path";

describe("logoCache", () => {
  const key = "TEST-icon";

  afterEach(() => {
    fs.rmSync(path.join(logoCacheDir(), `${key}.img`), { force: true });
    fs.rmSync(path.join(logoCacheDir(), `${key}.meta.json`), { force: true });
  });

  it("returns null on a cold miss", async () => {
    expect(await getCachedLogo("NOPE-icon")).toBeNull();
  });

  it("round-trips body and content type", async () => {
    const body = Buffer.from("<svg/>");
    await putCachedLogo(key, { body, contentType: "image/svg+xml" });
    const hit = await getCachedLogo(key);
    expect(hit).not.toBeNull();
    expect(hit!.contentType).toBe("image/svg+xml");
    expect(hit!.body.equals(body)).toBe(true);
  });

  it("rejects keys with path characters", async () => {
    await expect(putCachedLogo("../evil", { body: Buffer.from("x"), contentType: "image/png" }))
      .rejects.toThrow();
  });
});
