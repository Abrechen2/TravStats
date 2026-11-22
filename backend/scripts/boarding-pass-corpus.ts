/**
 * Run the boarding-pass reader over the local image corpus and score it.
 *
 * The corpus is `test-samples/boarding-passes/` — gitignored, the owner's own
 * passes. This script carries no data, only the way to measure. It reads
 * `samples.json` (tracked) and every `*.local.json` beside it (gitignored:
 * passes whose expectations name real people must never reach the public
 * repository), skipping entries whose image is not present.
 *
 * Same pipeline as `POST /parse-boardingpass` (`readBoardingPass`): barcode,
 * OCR, parser. Flight lookup and the language model are off — this measures
 * what the server reads by itself, without network.
 *
 * Usage (from backend/):
 *   DATABASE_URL=… npx tsx scripts/boarding-pass-corpus.ts [--dir ../test-samples/boarding-passes] [--min-score 0.9]
 *
 * Exits 1 when a sample failed to read, or when `--min-score` (share of
 * expected fields read correctly, 0–1) is given and the run falls below it —
 * so a broken run cannot look successful.
 */
import fs from "fs";
import path from "path";
import { readBoardingPass } from "../src/services/boardingPassRead";

type Expected = Record<string, string | null | undefined>;
interface Sample {
  filename: string;
  expected?: Expected;
  expectedFlights?: Expected[];
}

const FIELDS = [
  "flightNumber",
  "departureCode",
  "arrivalCode",
  "date",
  "departureTime",
  "arrivalTime",
  "seat",
] as const;

function argDir(): string {
  const i = process.argv.indexOf("--dir");
  return path.resolve(i >= 0 ? process.argv[i + 1] : "../test-samples/boarding-passes");
}

function argMinScore(): number | undefined {
  const i = process.argv.indexOf("--min-score");
  if (i < 0) return undefined;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("--min-score takes a share between 0 and 1, e.g. 0.9");
  }
  return value;
}

function loadSamples(dir: string): Sample[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f === "samples.json" || f.endsWith(".local.json"))
    .sort();
  return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Sample[]);
}

/** The legacy samples carry the BOARDING time as `departureTime`; compare the date only there. */
function expectedOf(sample: Sample): Expected[] {
  if (sample.expectedFlights) return sample.expectedFlights;
  const e = sample.expected ?? {};
  return [{ ...e, date: e.departureTime?.slice(0, 10), departureTime: undefined }];
}

async function main(): Promise<number> {
  const dir = argDir();
  const minScore = argMinScore();
  let failures = 0;
  let hits = 0;
  let total = 0;
  for (const sample of loadSamples(dir)) {
    const file = path.join(dir, sample.filename);
    if (!fs.existsSync(file)) {
      console.log(`skip ${sample.filename} (image not present)`);
      continue;
    }
    const started = Date.now();
    const reading = await readBoardingPass({
      imageBase64: fs.readFileSync(file).toString("base64"),
      userId: "corpus",
      enrich: false,
      allowLlm: false,
    }).catch((err: unknown) => {
      console.log(`FAIL ${sample.filename}: ${err instanceof Error ? err.message : String(err)}`);
      failures++;
      return null;
    });
    if (!reading) continue;
    const expected = expectedOf(sample);
    const lines: string[] = [];
    expected.forEach((exp, i) => {
      const leg = reading.legs[i];
      for (const field of FIELDS) {
        const want = exp[field];
        if (want === undefined) continue;
        const got =
          field === "date"
            ? leg?.departureTime?.slice(0, 10)
            : (leg as Record<string, unknown> | undefined)?.[field];
        total++;
        if ((got ?? null) === want) hits++;
        else
          lines.push(
            `  leg ${i + 1} ${field}: want ${want ?? "null"}, got ${String(got ?? "null")}`
          );
      }
    });
    console.log(
      `${lines.length === 0 ? "ok  " : "MISS"} ${sample.filename} legs=${reading.legs.length}/${expected.length} ` +
        `${Date.now() - started}ms stages=${reading.stages.map((s) => `${s.stage}:${s.code}`).join(",")}`
    );
    for (const line of lines) console.log(line);
  }
  const score = total === 0 ? 0 : hits / total;
  console.log(`\n${hits}/${total} fields correct (${(score * 100).toFixed(1)} %)`);
  if (failures > 0) {
    console.log(`${failures} sample(s) could not be read`);
    return 1;
  }
  if (minScore !== undefined && score < minScore) {
    console.log(`below --min-score ${minScore}`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
