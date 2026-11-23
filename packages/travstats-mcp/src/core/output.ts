import { ToolFailure } from "./errors";

export const OUTPUT_CAP_BYTES = 20_000;

/**
 * Keeps a tool result under the output cap by halving its longest array until it fits.
 * Says so (`truncated: true`) instead of dropping rows quietly.
 */
export function capOutput(
  data: Record<string, unknown>,
  cap = OUTPUT_CAP_BYTES
): Record<string, unknown> {
  let out = { ...data };
  let truncated = false;
  while (JSON.stringify(out).length > cap) {
    const arrays = Object.entries(out).filter(([, v]) => Array.isArray(v) && v.length > 1);
    if (!arrays.length) {
      return {
        instance: out.instance,
        truncated: true,
        note: "The result is larger than the output cap and has no list to cut.",
      };
    }
    const [key, list] = arrays.sort(
      (a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length
    )[0];
    out = {
      ...out,
      [key]: (list as unknown[]).slice(0, Math.ceil((list as unknown[]).length / 2)),
    };
    truncated = true;
  }
  return truncated ? { ...out, truncated: true } : out;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o?: unknown }).o;
    if (typeof o === "number" && Number.isInteger(o) && o >= 0) return o;
  } catch {
    /* falls through */
  }
  throw new ToolFailure("invalid_input", "cursor is not one this tool handed out");
}
