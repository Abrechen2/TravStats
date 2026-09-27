import fs from "fs";
import path from "path";

/**
 * The one network helper of the demo geometry generators. Every service they
 * ask is public and run by volunteers, so each question is asked once: the
 * raw answer is cached under `scripts/demo/.cache/` (gitignored), a rerun
 * that only changes the post-processing costs no request, requests are
 * paced, and the User-Agent says what is asking.
 */

const USER_AGENT = "TravStats-demo-geometry/1.0 (one-off generator for the demo account)";
const PAUSE_MS = 1500;
const CACHE_DIR = path.resolve(__dirname, ".cache");
const REFETCH = process.argv.includes("--refetch");

export type Json = Record<string, unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function cachedFetchJson(url: string, cacheKey: string): Promise<Json> {
  const file = path.join(CACHE_DIR, `${cacheKey.replace(/[^a-z0-9#-]/gi, "_")}.json`);
  if (!REFETCH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as Json;
  await sleep(PAUSE_MS);
  let res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  // A per-minute quota (Open-Meteo counts each coordinate): wait it out and
  // ask once more, rather than hammering or giving up.
  for (let attempt = 0; res.status === 429 && attempt < 12; attempt++) {
    const hourly = (await res.clone().text()).includes("Hourly");
    process.stdout.write(
      `  ${cacheKey}: rate-limited (${hourly ? "hourly" : "per minute"}), waiting\n`
    );
    await sleep(hourly ? 600_000 : 65_000);
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }
  // BRouter's public server cuts a request off when it is busy ("operation
  // killed by thread-priority-watchdog", 400) and turns a client away for a
  // while after a run of requests ("Please, retry later!", 403); the same
  // question answers later, so wait and ask again instead of failing the run.
  for (let attempt = 0; (res.status === 400 || res.status === 403) && attempt < 8; attempt++) {
    const text = await res.clone().text();
    const busy = text.includes("watchdog");
    if (!busy && !text.includes("retry later")) break;
    process.stdout.write(`  ${cacheKey}: router ${busy ? "busy" : "asks to retry later"}\n`);
    await sleep(busy ? 20_000 : 90_000);
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }
  if (!res.ok) throw new Error(`${cacheKey}: ${url} answered ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Json;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
  process.stdout.write(`  fetched ${cacheKey}\n`);
  return body;
}
