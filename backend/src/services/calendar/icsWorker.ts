/**
 * `parseIcsTexts` in a worker thread that is terminated at the read's deadline
 * (security review, MEDIUM): the parser's own deadline checks run between
 * occurrences, but a recurrence or time-zone expansion inside ical.js can loop
 * without ever returning to them. Only a thread that can be killed holds a
 * time cap over code we do not control. The worker also runs under a heap cap,
 * so a parse that balloons stays inside it.
 */
import { Worker } from "worker_threads";
import { CalendarError, CALENDAR_FAILURE_CODES, CALENDAR_FAILURE_KINDS } from "./errors";
import { PARSE_DEADLINE_MS, type ParseOptions, type ParsedWindow } from "./icsParse";

const HEAP_MB = 256;

type Reply =
  | { ok: true; result: ParsedWindow }
  | { ok: false; kind?: string; code?: string | null; message?: string };

const SOURCE = `
const { parentPort, workerData } = require("worker_threads");
if (workerData.ts) require("tsx/cjs");
if (workerData.spin) { for (;;) {} }
const { parseIcsTexts } = require(workerData.module);
try {
  parentPort.postMessage({ ok: true, result: parseIcsTexts(workerData.texts, workerData.options) });
} catch (e) {
  parentPort.postMessage({ ok: false, kind: e && e.kind, code: e && e.code, message: String(e && e.message) });
}
`;

export interface WorkerParseOptions extends Omit<ParseOptions, "now" | "deadlineMs"> {
  /** Absolute deadline (epoch ms) of the whole read. */
  deadlineAt: number;
  /** Test only (NODE_ENV=test): the worker never returns, so the kill is what answers. */
  spinForTest?: boolean;
}

function asCalendarError(reply: Extract<Reply, { ok: false }>): CalendarError {
  const kind = (CALENDAR_FAILURE_KINDS as readonly string[]).includes(reply.kind ?? "")
    ? (reply.kind as CalendarError["kind"])
    : "protocol";
  const code = (CALENDAR_FAILURE_CODES as readonly string[]).includes(reply.code ?? "")
    ? (reply.code as CalendarError["code"])
    : kind === "protocol"
      ? "CALENDAR_PARSE"
      : null;
  return new CalendarError(kind, code);
}

export function parseIcsInWorker(
  texts: readonly string[],
  options: WorkerParseOptions
): Promise<ParsedWindow> {
  const modulePath = require.resolve("./icsParse");
  const { spinForTest, ...parseOptions } = options;
  // The parse may not outlive the read, nor take longer than a parse may.
  const deadlineAt = Math.min(options.deadlineAt, Date.now() + PARSE_DEADLINE_MS);
  return new Promise((resolve, reject) => {
    const worker = new Worker(SOURCE, {
      eval: true,
      workerData: {
        module: modulePath,
        ts: modulePath.endsWith(".ts"),
        spin: spinForTest === true && process.env.NODE_ENV === "test",
        texts,
        options: { ...parseOptions, deadlineAt },
      },
      resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new CalendarError("protocol", "CALENDAR_PARSE_TIMEOUT"))),
      Math.max(0, deadlineAt - Date.now())
    );
    worker.on("message", (reply: Reply) =>
      settle(() => (reply.ok ? resolve(reply.result) : reject(asCalendarError(reply))))
    );
    worker.on("error", () => settle(() => reject(new CalendarError("protocol", "CALENDAR_PARSE"))));
    worker.on("exit", () =>
      settle(() => reject(new CalendarError("protocol", "CALENDAR_PARSE_TIMEOUT")))
    );
  });
}
