import { createSlowLog, type SlowEntry } from "../slowLog";

/**
 * Perf audit 2026-11, item 4: prod had no latency record. Slow requests and
 * queries are logged at warn, rate-limited per key so a poll cannot flood it.
 */
describe("the slow-work log", () => {
  function setup() {
    let t = 1_000_000;
    const lines: SlowEntry[] = [];
    const log = createSlowLog({
      thresholdMs: 500,
      windowMs: 60_000,
      sink: (e) => lines.push(e),
      now: () => t,
    });
    return { log, lines, advance: (ms: number) => (t += ms) };
  }

  it("ignores work under the threshold", () => {
    const { log, lines } = setup();
    log.note("Flight.findMany", 499);
    expect(lines).toEqual([]);
  });

  it("logs once per key and window, then reports what it suppressed", () => {
    const { log, lines, advance } = setup();
    log.note("GET /api/v1/stats", 1200);
    log.note("GET /api/v1/stats", 1500);
    log.note("GET /api/v1/stats", 1800);
    expect(lines).toHaveLength(1);
    advance(60_000);
    log.note("GET /api/v1/stats", 900);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ durationMs: 900, suppressed: 2 });
  });

  it("does not let one key silence another", () => {
    const { log, lines } = setup();
    log.note("a", 600);
    log.note("b", 700);
    expect(lines.map((l) => l.key)).toEqual(["a", "b"]);
  });

  it("keeps the most recent entries for the runtime card, newest first", () => {
    const { log } = setup();
    log.note("a", 600);
    log.note("b", 700);
    expect(log.recent().map((e) => e.key)).toEqual(["b", "a"]);
  });
});
