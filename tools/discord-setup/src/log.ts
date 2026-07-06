export function log(message: string): void {
  console.log(message);
}

export function dryRunLog(message: string): void {
  console.log(`[dry-run] ${message}`);
}
