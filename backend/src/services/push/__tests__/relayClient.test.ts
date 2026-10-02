import { prisma } from "../../../db";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import { decryptApiKey } from "../../../utils/encryption";
import { systemLogger } from "../../../utils/logger";
import { sendToRelay } from "../relayClient";

/**
 * The relay client (TravStats#156, spec §3.3): registers this instance once
 * with push.travstats.de, then forwards sealed pushes. It never throws, and
 * it never touches the network while the admin has not switched push on.
 */
const push = {
  platform: "ios" as const,
  token: "a".repeat(64),
  apnsEnvironment: "production",
  ciphertext: "C".repeat(120),
  collapseId: "f1",
  lang: "de" as const,
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

type Call = { url: string; init: RequestInit };
function relay(...pushAnswers: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchFn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/v1/instances"))
      return json(201, { instanceId: "inst123456789012", secret: "s".repeat(43) });
    const next = pushAnswers.shift() ?? new Response(null, { status: 202 });
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetch: fetchFn as unknown as typeof fetch };
}

let adminId: number;
async function settings(data: Record<string, unknown>) {
  await prisma.adminSettings.update({ where: { id: adminId }, data });
}

beforeAll(async () => {
  adminId = await ensureAdminSettingsRow();
});

beforeEach(async () => {
  await settings({
    pushEnabled: true,
    pushRelayUrl: "https://push.example.test",
    pushInstanceId: null,
    pushInstanceSecret: null,
    pushPausedUntil: null,
    publicUrl: "https://trav.example.de",
  });
});

afterAll(async () => {
  await settings({
    pushEnabled: false,
    pushInstanceId: null,
    pushInstanceSecret: null,
    pushPausedUntil: null,
    publicUrl: null,
  });
  await prisma.$disconnect();
});

describe("sendToRelay", () => {
  it("does nothing at all — not even register — while the admin has not switched push on", async () => {
    await settings({ pushEnabled: false });
    const r = relay();
    expect(await sendToRelay(push, { fetch: r.fetch })).toBe("disabled");
    expect(r.calls).toHaveLength(0);
  });

  it("registers once, stores the secret encrypted, then pushes with Bearer id.secret", async () => {
    const r = relay();
    expect(await sendToRelay(push, { fetch: r.fetch })).toBe("sent");
    expect(r.calls.map((c) => c.url)).toEqual([
      "https://push.example.test/v1/instances",
      "https://push.example.test/v1/push",
    ]);
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ name: "TravStats trav.example.de" });
    expect((r.calls[1].init.headers as Record<string, string>).authorization).toBe(
      `Bearer inst123456789012.${"s".repeat(43)}`
    );
    expect(JSON.parse(String(r.calls[1].init.body))).toEqual(push);

    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushInstanceId).toBe("inst123456789012");
    expect(row?.pushInstanceSecret).not.toContain("s".repeat(43));
    expect(decryptApiKey(row?.pushInstanceSecret)).toBe("s".repeat(43));

    expect(await sendToRelay(push, { fetch: r.fetch })).toBe("sent");
    expect(r.calls.filter((c) => c.url.endsWith("/v1/instances"))).toHaveLength(1);
  });

  it.each([
    ["switched off", { pushEnabled: false }],
    ["relay address changed", { pushRelayUrl: "https://other.example.test" }],
  ])("drops a registration that finishes after the admin %s", async (_name, change) => {
    const r = relay();
    const inner = r.fetch;
    const racing = (async (url: string | URL, init?: RequestInit) => {
      const res = await inner(url, init);
      if (String(url).endsWith("/v1/instances")) await settings(change);
      return res;
    }) as unknown as typeof fetch;
    expect(await sendToRelay(push, { fetch: racing })).toBe("failed");
    expect(r.calls.map((c) => c.url)).toEqual(["https://push.example.test/v1/instances"]);
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushInstanceId).toBeNull();
    expect(row?.pushInstanceSecret).toBeNull();
  });

  it("names the instance 'self-hosted' when it has no public URL", async () => {
    await settings({ publicUrl: null });
    const r = relay();
    await sendToRelay(push, { fetch: r.fetch });
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ name: "TravStats self-hosted" });
  });

  it.each([
    ["https://trav.example.de:8443", "TravStats trav.example.de"],
    ["http://[2001:db8::1]:3000", "TravStats 2001-db8--1"],
    [`https://${"x".repeat(80)}.example.de`, `TravStats ${"x".repeat(54)}`],
  ])("names the instance from %s with characters the relay accepts", async (publicUrl, name) => {
    await settings({ publicUrl });
    const r = relay();
    expect(await sendToRelay(push, { fetch: r.fetch })).toBe("sent");
    const sent = JSON.parse(String(r.calls[0].init.body)).name as string;
    expect(sent).toBe(name);
    // The relay's own rule (travstats-push src/schema.ts).
    expect(sent.length).toBeLessThanOrEqual(64);
    expect(sent).toMatch(/^[\p{L}\p{N} ._'()-]*$/u);
  });

  it("registers only once when two first pushes run at the same time", async () => {
    let registrations = 0;
    const fetchFn = (async (url: string | URL) => {
      if (String(url).endsWith("/v1/instances")) {
        registrations += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return json(201, { instanceId: "inst123456789012", secret: "s".repeat(43) });
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const outcomes = await Promise.all([
      sendToRelay(push, { fetch: fetchFn }),
      sendToRelay(push, { fetch: fetchFn }),
    ]);
    expect(registrations).toBe(1);
    expect(outcomes).toEqual(["sent", "sent"]);
  });

  it("pauses for Retry-After when the registration itself is rate-limited", async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      calls.push(String(url));
      return json(429, { error: "rate_limited" }, { "retry-after": "3600" });
    }) as unknown as typeof fetch;
    expect(await sendToRelay(push, { fetch: fetchFn, now: () => now })).toBe("paused");
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushPausedUntil?.toISOString()).toBe("2026-10-01T13:00:00.000Z");
    expect(
      await sendToRelay(push, { fetch: fetchFn, now: () => new Date("2026-10-01T12:30:00Z") })
    ).toBe("paused");
    expect(calls).toHaveLength(1);
  });

  it("logs an outage again after the relay worked in between", async () => {
    const warn = jest.spyOn(systemLogger, "warn");
    try {
      const r = relay(
        new Response(null, { status: 202 }),
        new Error("ECONNREFUSED"),
        new Error("ECONNREFUSED"),
        new Response(null, { status: 202 }),
        new Error("ECONNREFUSED")
      );
      for (let i = 0; i < 5; i++) await sendToRelay(push, { fetch: r.fetch });
      const outages = warn.mock.calls.filter((c) =>
        String((c[0] as { message?: string }).message).includes("unreachable")
      );
      expect(outages).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    [new Response(null, { status: 410 }), "failed"],
    [json(410, { error: "gone" }), "failed"],
    [json(410, { reason: "token-invalid" }), "token-invalid"],
    [json(403, { error: "forbidden" }), "failed"],
    [json(502, { error: "provider_failed" }), "failed"],
    [new Error("ECONNREFUSED"), "failed"],
    [Object.assign(new Error("aborted"), { name: "TimeoutError" }), "failed"],
  ])("maps a relay answer to %#", async (answer, expected) => {
    const r = relay(answer as Response | Error);
    expect(await sendToRelay(push, { fetch: r.fetch })).toBe(expected);
  });

  it("forgets its credentials on 401, so the next push registers anew", async () => {
    const r = relay(json(401, { error: "unauthorized" }));
    expect(await sendToRelay(push, { fetch: r.fetch })).toBe("failed");
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushInstanceId).toBeNull();
    expect(row?.pushInstanceSecret).toBeNull();
    await sendToRelay(push, { fetch: r.fetch });
    expect(r.calls.filter((c) => c.url.endsWith("/v1/instances"))).toHaveLength(2);
  });

  it("pauses for Retry-After on 429 and does not call the relay while paused", async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const r = relay(json(429, { error: "rate_limited" }, { "retry-after": "120" }));
    expect(await sendToRelay(push, { fetch: r.fetch, now: () => now })).toBe("paused");
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushPausedUntil?.toISOString()).toBe("2026-10-01T12:02:00.000Z");

    const callsBefore = r.calls.length;
    expect(
      await sendToRelay(push, { fetch: r.fetch, now: () => new Date("2026-10-01T12:01:00Z") })
    ).toBe("paused");
    expect(r.calls).toHaveLength(callsBefore);
    expect(
      await sendToRelay(push, { fetch: r.fetch, now: () => new Date("2026-10-01T12:02:01Z") })
    ).toBe("sent");
  });

  it("caps a huge Retry-After at 24 hours", async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const r = relay(json(429, {}, { "retry-after": "9999999" }));
    await sendToRelay(push, { fetch: r.fetch, now: () => now });
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushPausedUntil?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("fails without storing anything when registration itself fails", async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error("relay down");
    }) as unknown as typeof fetch;
    expect(await sendToRelay(push, { fetch: fetchFn })).toBe("failed");
    const row = await prisma.adminSettings.findUnique({ where: { id: adminId } });
    expect(row?.pushInstanceId).toBeNull();
  });
});
