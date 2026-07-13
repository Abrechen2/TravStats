/**
 * The single output path for this CLI. Everything else in the tool returns
 * values; only the entry point and the collectors' progress notes print.
 */
export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}
