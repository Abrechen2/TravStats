import { Blob as NodeBlob, Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { api } from "../../../lib/api/client";
import { comparisonPost, type Link } from "../../../lib/api/comparison";
import { pinnedDevices, checkFreshness } from "../../../lib/comparison/vault";
import { generateDevice, digest, type Manifest } from "../../../lib/comparison/crypto";
import { publish, readPublication, type SourceData } from "../../../lib/comparison/transport";
vi.mock("../../../lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonPost: vi.fn(),
}));
vi.mock("../../../lib/comparison/vault", () => ({
  pinnedDevices: vi.fn(),
  checkFreshness: vi.fn(),
}));
beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("btoa", (s: string) => Buffer.from(s, "binary").toString("base64"));
  vi.stubGlobal("atob", (s: string) => Buffer.from(s, "base64").toString("binary"));
});
it("publishes and receives all nested data plus a file larger than the former 5 MiB cap", async () => {
  const [a, b] = await Promise.all([generateDevice("a"), generateDevice("b")]);
  const channel = crypto.randomUUID(),
    id = crypto.randomUUID();
  const link: Link = {
    id,
    channel,
    label: "B",
    origin: "local",
    confirmed: true,
    remoteConfirmed: true,
    code: "123456",
    grants: [],
  };
  vi.mocked(pinnedDevices).mockImplementation(async (account) => ({
    [`friend:${channel}:${account === "a" ? b.device.public.fingerprint : a.device.public.fingerprint}`]:
      account === "a" ? b.device.public : a.device.public,
  }));
  vi.mocked(comparisonPost).mockResolvedValue({ revision: 1 });
  const data: SourceData = {
    version: 2,
    asOf: new Date().toISOString(),
    scope: {
      statistics: true,
      details: true,
      personal: true,
      costs: true,
      documents: true,
      photos: true,
      domains: ["flight"],
      tripIds: [],
      year: null,
      futureTrips: true,
      precision: "exact",
      expiresAt: null,
    },
    snapshot: {
      version: 1,
      definition: "travstats-comparison-1",
      asOf: new Date().toISOString(),
      year: null,
      precision: "exact",
      coverage: "all",
      domains: ["flight"],
      currency: "EUR",
      metrics: { flights: 1, distance: 100, minutes: 5, cost: 24.5, daysAway: 1, countries: 1 },
      details: true,
      trips: [],
    },
    sections: {
      flights: [
        {
          notes: "only the devices should see this",
          track: {
            geometry: {
              type: "LineString",
              coordinates: [
                [8, 49],
                [9, 50],
              ],
            },
          },
        },
      ],
    },
    assets: [
      {
        key: "document:test",
        kind: "document",
        id: crypto.randomUUID(),
        name: "evidence.pdf",
        mime: "application/pdf",
        size: 6 * 1024 * 1024 + 17,
      },
    ],
    omitted: [],
  };
  const bytes = new Uint8Array(data.assets[0].size!);
  bytes.fill(47);
  bytes[bytes.length - 1] = 93;
  const chunks = new Map<number, string>();
  let manifest: Manifest | null = null;
  vi.mocked(api.get).mockResolvedValue({ data: new Blob([bytes]) });
  vi.mocked(api.post).mockImplementation(async (url, body: unknown) => {
    const p = String(url),
      bdy = body as Record<string, unknown>;
    if (p.endsWith("/chunk")) {
      chunks.set(Number(bdy.part), String(bdy.bytes));
      return { data: { data: { stored: true } } };
    }
    if (p.endsWith("/finish")) {
      manifest = body as Manifest;
      return { data: { data: { published: true } } };
    }
    if (p.endsWith("/read"))
      return {
        data: {
          data:
            bdy.part === undefined
              ? { manifest, sender: a.device.public }
              : { part: bdy.part, bytes: chunks.get(Number(bdy.part)) },
        },
      };
    return { data: { data: {} } };
  });
  await publish(
    "a",
    a.device,
    [link],
    { linkId: id },
    {
      audience: "",
      members: [{ source: channel, label: "b", origin: "local", devices: [b.device.public] }],
    },
    data.scope,
    data,
    () => undefined
  );
  expect(chunks.size).toBeGreaterThan(24);
  expect(JSON.stringify([...chunks.values()])).not.toContain("only the devices should see this");
  const received = await readPublication(
    "b",
    b.device,
    { linkId: id, audience: "" },
    [a.device.public],
    channel
  );
  expect(received!.data.sections).toEqual(data.sections);
  const downloaded = new Uint8Array(
    await (await received!.download("document:test")).arrayBuffer()
  );
  expect(await digest(downloaded)).toBe(await digest(bytes));
  expect(checkFreshness).toHaveBeenCalledOnce();
  vi.mocked(pinnedDevices).mockResolvedValue({});
  await expect(
    readPublication("b", b.device, { linkId: id, audience: "" }, [a.device.public], channel)
  ).rejects.toThrow("E2E_UNVERIFIED_SENDER");
}, 20000);
