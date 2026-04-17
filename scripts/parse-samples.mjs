#!/usr/bin/env node
/**
 * parse-samples.mjs
 *
 * Tests the Ollama text parser against sample emails with different models.
 * Compares results against expected data from samples.json.
 *
 * Usage:
 *   node scripts/parse-samples.mjs                    # test all models against samples.json
 *   node scripts/parse-samples.mjs --model gemma4     # test single model
 *   node scripts/parse-samples.mjs --all              # test ALL .msg files (not just samples.json)
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

// msgreader lives in backend/node_modules
const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
);
const MsgReader = require("@kenjiuno/msgreader").default ?? require("@kenjiuno/msgreader");

// ---------- Config ----------
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const SAMPLES_DIR = path.resolve("test-samples/emails");
const SAMPLES_JSON = path.join(SAMPLES_DIR, "samples.json");
const TIMEOUT_MS = 300_000;

const ALL_MODELS = [
  "gemma3:12b",
  "gemma4:latest",
  "qwen3:30b-a3b",
];

// ---------- CLI args ----------
const args = process.argv.slice(2);
const singleModel = args.find((a) => a.startsWith("--model="))?.split("=")[1]
  || (args.includes("--model") ? args[args.indexOf("--model") + 1] : null);
const testAll = args.includes("--all");
const MODELS = singleModel ? [singleModel] : ALL_MODELS;

// ---------- System prompt (matches ollamaTextParser.ts) ----------
const SYSTEM_PROMPT = `You are a flight booking data extractor. Extract all flight segments from booking confirmation emails.
Return a JSON array. Each element is one flight leg with these fields:
- flightNumber: string (e.g. "LH2424", no space)
- departureCode: string (IATA, 3 letters, e.g. "MUC")
- arrivalCode: string (IATA, 3 letters)
- departureTime: string (ISO 8601, e.g. "2024-06-10T12:35")
- arrivalTime: string (ISO 8601)
- seat: string or null (e.g. "11C")
- seatClass: "economy" | "premium_economy" | "business" | "first" or null
- airline: string (marketing carrier name)
- operatingAirline: string or null (actual operator if different from marketing carrier)
- pnr: string or null (booking reference / PNR)
- ticketNumber: string or null

Rules:
- Extract ALL flight legs, including connecting flights and return legs
- Use IATA codes only (3-letter airport codes)
- Dates must be ISO 8601 with time component
- If operatingAirline is the same as airline, set it to null
- Return ONLY the JSON array, no explanation, no markdown, no <think> tags
/no_think
`;

// ---------- Helpers ----------

function fetchJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + (parsed.search ?? ""),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    });
    req.setTimeout(TIMEOUT_MS, () =>
      req.destroy(new Error(`Timeout after ${TIMEOUT_MS}ms`))
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function cleanEmailBody(text) {
  let out = text;
  out = out.replace(/<[^>]+>/g, "");
  out = out.replace(/https?:\/\/[^\s<>]+/gi, "");
  out = out.replace(/www\.[^\s<>]+/gi, "");
  out = out.split("\n").map((l) => l.trim()).join("\n");
  out = out.replace(/\n{2,}/g, "\n");
  out = out.replace(/[ \t]{2,}/g, " ");
  return out.trim();
}

function extractMsg(filePath) {
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  const reader = new MsgReader(arrayBuffer);
  const data = reader.getFileData();
  return {
    subject: data.subject || "",
    text: data.body || "",
    html: data.bodyHtml || undefined,
  };
}

function parseOllamaResponse(raw) {
  const response = JSON.parse(raw);
  const responseText = response.response;
  if (typeof responseText !== "string") throw new Error("No response text");

  const cleaned = responseText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();

  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in response");

  return { flights: JSON.parse(jsonMatch[0]), meta: response };
}

async function parseWithModel(model, subject, text) {
  const snippet = text.slice(0, 5000);
  const userPrompt = `Subject: ${subject}\n\n${snippet}`;

  const body = JSON.stringify({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    stream: false,
    think: false,
    options: { temperature: 0.1 },
  });

  const start = Date.now();
  const raw = await fetchJson(`${OLLAMA_URL}/api/generate`, body);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const { flights, meta } = parseOllamaResponse(raw);

  const tokensPerSec = meta.eval_count && meta.eval_duration
    ? (meta.eval_count / (meta.eval_duration / 1e9)).toFixed(1)
    : "?";

  return { flights, elapsed, tokensPerSec };
}

// ---------- Comparison ----------

function normalizeTime(t) {
  if (!t) return null;
  return t.slice(0, 16);
}

function compareFlight(actual, expected) {
  const fields = ["flightNumber", "departureCode", "arrivalCode", "departureTime", "arrivalTime", "pnr", "seat"];
  const results = {};
  let matches = 0;
  let total = 0;

  for (const f of fields) {
    const exp = expected[f] ?? null;
    let act = actual?.[f] ?? null;

    if (f === "departureTime" || f === "arrivalTime") {
      act = normalizeTime(act);
      const expNorm = normalizeTime(exp);
      if (exp !== null) {
        total++;
        if (act === expNorm) { matches++; results[f] = "OK"; }
        else results[f] = `MISMATCH: got "${act}" expected "${expNorm}"`;
      }
    } else if (f === "flightNumber") {
      total++;
      const actClean = (act || "").replace(/\s+/g, "").toUpperCase();
      const expClean = (exp || "").replace(/\s+/g, "").toUpperCase();
      if (actClean === expClean) { matches++; results[f] = "OK"; }
      else results[f] = `MISMATCH: got "${act}" expected "${exp}"`;
    } else if (exp !== null && exp !== undefined) {
      total++;
      const actUpper = (act || "").toUpperCase();
      const expUpper = (exp || "").toUpperCase();
      if (actUpper === expUpper) { matches++; results[f] = "OK"; }
      else results[f] = `MISMATCH: got "${act}" expected "${exp}"`;
    }
  }

  return { results, matches, total, score: total > 0 ? (matches / total * 100) : 0 };
}

function compareFlights(actualFlights, expectedFlights) {
  const comparisons = [];
  let totalMatches = 0;
  let totalFields = 0;

  const countMatch = actualFlights.length === expectedFlights.length;

  for (let i = 0; i < expectedFlights.length; i++) {
    const expected = expectedFlights[i];
    const actual = actualFlights.find(
      (a) => (a.flightNumber || "").replace(/\s/g, "").toUpperCase() ===
             (expected.flightNumber || "").replace(/\s/g, "").toUpperCase()
    ) || actualFlights[i] || null;

    if (!actual) {
      comparisons.push({ expected: expected.flightNumber, status: "MISSING", score: 0, details: {} });
      totalFields += 7;
      continue;
    }

    const { results, matches, total, score } = compareFlight(actual, expected);
    comparisons.push({
      expected: expected.flightNumber,
      status: score === 100 ? "PERFECT" : score >= 70 ? "PARTIAL" : "POOR",
      score,
      details: results,
    });
    totalMatches += matches;
    totalFields += total;
  }

  const extraFlights = actualFlights.filter(
    (a) => !expectedFlights.some(
      (e) => (a.flightNumber || "").replace(/\s/g, "").toUpperCase() ===
             (e.flightNumber || "").replace(/\s/g, "").toUpperCase()
    )
  );

  return {
    countMatch,
    actualCount: actualFlights.length,
    expectedCount: expectedFlights.length,
    extraFlights: extraFlights.length,
    comparisons,
    overallScore: totalFields > 0 ? (totalMatches / totalFields * 100) : 0,
  };
}

// ---------- Main ----------

async function main() {
  console.log("=".repeat(80));
  console.log("TravStats Parser Benchmark");
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log(`Models: ${MODELS.join(", ")}`);
  console.log("=".repeat(80));

  const samples = JSON.parse(fs.readFileSync(SAMPLES_JSON, "utf-8"));

  let testFiles = samples.map((s) => ({
    filename: s.filename,
    filepath: path.join(SAMPLES_DIR, s.filename),
    expected: s.expected,
    notes: s.notes,
  }));

  if (testAll) {
    const allMsgs = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".msg"));
    for (const msg of allMsgs) {
      if (!testFiles.some((t) => t.filename === msg)) {
        testFiles.push({ filename: msg, filepath: path.join(SAMPLES_DIR, msg), expected: null, notes: null });
      }
    }
  }

  console.log(`\nTest files: ${testFiles.length} (${samples.length} with expected data)\n`);

  const modelScores = {};

  for (const model of MODELS) {
    console.log("\n" + "-".repeat(80));
    console.log(`MODEL: ${model}`);
    console.log("-".repeat(80));

    modelScores[model] = {
      totalScore: 0, totalFiles: 0, perfectFlights: 0,
      totalExpectedFlights: 0, totalTime: 0, errors: 0, countMismatches: 0,
    };

    for (const testFile of testFiles) {
      const shortName = testFile.filename.slice(0, 55);
      process.stdout.write(`  ${shortName.padEnd(58)} `);

      try {
        const email = extractMsg(testFile.filepath);
        const cleaned = cleanEmailBody(email.text);
        const { flights, elapsed, tokensPerSec } = await parseWithModel(model, email.subject, cleaned);

        modelScores[model].totalTime += parseFloat(elapsed);

        if (testFile.expected) {
          const result = compareFlights(flights, testFile.expected);
          modelScores[model].totalFiles++;
          modelScores[model].totalScore += result.overallScore;
          modelScores[model].totalExpectedFlights += result.expectedCount;
          if (!result.countMatch) modelScores[model].countMismatches++;

          for (const c of result.comparisons) {
            if (c.status === "PERFECT") modelScores[model].perfectFlights++;
          }

          const scoreStr = result.overallScore.toFixed(0).padStart(3) + "%";
          const countStr = result.countMatch
            ? `${result.actualCount}/${result.expectedCount}`
            : `${result.actualCount}/${result.expectedCount} !!`;

          console.log(`${scoreStr}  flights: ${countStr}  ${elapsed}s  ${tokensPerSec} t/s`);

          for (const c of result.comparisons) {
            if (c.status !== "PERFECT") {
              for (const [field, detail] of Object.entries(c.details)) {
                if (detail !== "OK") {
                  console.log(`    ${c.expected} ${field}: ${detail}`);
                }
              }
            }
          }
          if (result.extraFlights > 0) {
            console.log(`    +${result.extraFlights} extra flight(s) detected`);
          }
        } else {
          const flightStrs = flights.map(
            (f) => `${f.flightNumber || "?"} ${f.departureCode}-${f.arrivalCode}`
          );
          console.log(`${flights.length} flights  ${elapsed}s  ${tokensPerSec} t/s  [${flightStrs.join(", ")}]`);
        }
      } catch (err) {
        modelScores[model].errors++;
        console.log(`ERROR: ${err.message}`);
      }
    }
  }

  // ---------- Summary ----------
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));

  const header = "Model".padEnd(25) +
    "Avg Score".padStart(10) +
    "Perfect".padStart(10) +
    "Count Err".padStart(10) +
    "Errors".padStart(8) +
    "Avg Time".padStart(10);
  console.log(header);
  console.log("-".repeat(73));

  for (const model of MODELS) {
    const s = modelScores[model];
    const avgScore = s.totalFiles > 0 ? (s.totalScore / s.totalFiles).toFixed(1) : "N/A";
    const perfectStr = `${s.perfectFlights}/${s.totalExpectedFlights}`;
    const avgTime = testFiles.length > 0 ? (s.totalTime / testFiles.length).toFixed(1) + "s" : "N/A";

    console.log(
      model.padEnd(25) +
      (avgScore + "%").padStart(10) +
      perfectStr.padStart(10) +
      String(s.countMismatches).padStart(10) +
      String(s.errors).padStart(8) +
      avgTime.padStart(10)
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
