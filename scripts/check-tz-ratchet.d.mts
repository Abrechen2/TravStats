// Types for check-tz-ratchet.mjs, for the frontend suite that tests it.
export interface TzRun {
  ran: Set<string>;
  failed: Set<string>;
}
export declare const BASELINE_PATH: string;
export declare const TREES: string[];
export declare const ZONES: string[];
export declare function relativeTestFile(file: string, treeRoot: string): string;
export declare function readRun(report: unknown, treeRoot: string): TzRun;
export declare function compareRun(
  listed: string[],
  run: TzRun,
  fileExists: (file: string) => boolean
): { newFailures: string[]; stale: string[] };
export declare function mergeRuns(runs: TzRun[]): TzRun;
