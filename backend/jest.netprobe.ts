// TEMPORARY measurement probe — logs every outbound request to a
// non-loopback host with the test that made it. Not a guard; removed after
// the measurement run.
import http from "node:http";
import https from "node:https";

const LOOPBACK = /^(localhost|127\.|::1|\[::1\]|0\.0\.0\.0)/;

function report(kind: string, target: unknown): void {
  let host = "";
  try {
    if (typeof target === "string") host = new URL(target).host;
    else if (target instanceof URL) host = target.host;
    else if (target && typeof target === "object") {
      const t = target as { url?: string; host?: string; hostname?: string };
      host = t.url ? new URL(t.url).host : (t.hostname ?? t.host ?? "");
    }
  } catch {
    host = String(target).slice(0, 80);
  }
  if (!host || LOOPBACK.test(host)) return;
  const state = expect.getState();
  process.stderr.write(
    `NETPROBE ${kind} ${host} :: ${String(state.testPath).replace(/.*\/src\//, "src/")} :: ${state.currentTestName}\n`
  );
}

const realFetch = globalThis.fetch;
if (realFetch) {
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    report("fetch", input);
    return realFetch(input, init);
  }) as typeof fetch;
}

for (const [kind, mod] of [
  ["http", http],
  ["https", https],
] as const) {
  const realRequest = mod.request;
  const realGet = mod.get;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mod as any).request = (...args: any[]) => {
    report(kind, args[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (realRequest as any)(...args);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mod as any).get = (...args: any[]) => {
    report(kind, args[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (realGet as any)(...args);
  };
}
