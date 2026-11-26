import { dropImmichDuplicates } from "../dedupe";
import { windowCandidates } from "../entryPhotos";
import type { PhotoSourceKind } from "../../photoSource";

const at = "2026-07-16T10:00:00.000Z";
const ms = Date.parse(at);

describe("dropImmichDuplicates", () => {
  it("drops an Immich photo PhotoPrism also holds (same instant ±2 s, same size)", () => {
    const out = dropImmichDuplicates([
      { provider: "photoprism" as const, takenMs: ms, width: 4000, height: 3000 },
      { provider: "immich" as const, takenMs: ms + 1500, width: 3000, height: 4000 },
    ]);
    expect(out.map((i) => i.provider)).toEqual(["photoprism"]);
  });

  it("keeps an Immich photo with another size, another instant, or no instant", () => {
    const out = dropImmichDuplicates([
      { provider: "photoprism" as const, takenMs: ms, width: 4000, height: 3000 },
      { provider: "immich" as const, takenMs: ms, width: 1000, height: 800 },
      { provider: "immich" as const, takenMs: ms + 5000, width: 4000, height: 3000 },
      { provider: "immich" as const, takenMs: null },
    ]);
    expect(out).toHaveLength(4);
  });

  it("keeps Immich alone where no PhotoPrism photo exists", () => {
    expect(dropImmichDuplicates([{ provider: "immich" as const, takenMs: ms }])).toHaveLength(1);
  });
});

describe("a roadtrip station's library search", () => {
  const window = { start: new Date(ms - 1000), end: new Date(ms + 1000) };
  const asset = (id: string) => ({ id, fileCreatedAt: at, mimeType: "image/jpeg" });
  const make = (prism: "ok" | "off" | "down") => {
    const asked: PhotoSourceKind[] = [];
    const search = async (provider: PhotoSourceKind) => {
      asked.push(provider);
      if (provider === "photoprism" && prism === "off")
        throw new (await import("../matcher")).NotConfigured();
      if (provider === "photoprism" && prism === "down") throw new Error("boom");
      return [asset(provider)] as never;
    };
    return { asked, search };
  };

  it("asks PhotoPrism alone when it is connected, so Immich's copy never shows twice", async () => {
    const { asked, search } = make("ok");
    const r = await windowCandidates("roadtripStop", search as never, window);
    expect(asked).toEqual(["photoprism"]);
    expect(r.candidates.map((c) => c.provider)).toEqual(["photoprism"]);
  });

  it("falls back to Immich where no PhotoPrism is connected", async () => {
    const { search } = make("off");
    const r = await windowCandidates("roadtripStop", search as never, window);
    expect(r.candidates.map((c) => c.provider)).toEqual(["immich"]);
  });

  it("leaves other entry kinds searching every source", async () => {
    const { asked, search } = make("ok");
    await windowCandidates("flight", search as never, window);
    expect(asked.sort()).toEqual(["immich", "photoprism"]);
  });
});
