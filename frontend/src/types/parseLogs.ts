/** Admin parser-log statistics (split out of types/index.ts to keep it under the size limit). */

export interface ParseLogAirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

export interface ParseLogStats {
  totalLogs: number;
  overallHitRate: number;
  byAirline: ParseLogAirlineStat[];
}

export interface PromoteCorrectionsResult {
  promoted: number;
  message: string;
}
