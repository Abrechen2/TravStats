import { z } from "./zod";

/**
 * Schema for logging configuration. The file size, the file count and the three
 * category switches (HTTP, database, parser) are fixed since settings v3 S6 and
 * no longer accepted: a request that still carries them has them dropped.
 */
export const loggingConfigSchema = z.object({
  logLevel: z.enum(["error", "warn", "info", "debug", "trace"]).optional(),
  logRetentionDays: z.number().min(1).max(90).optional(), // 1-90 days
});

/**
 * Schema for toggling debug logging
 */
export const toggleDebugLoggingSchema = z.object({
  enabled: z.boolean(),
});

const logCategory = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

/**
 * Schema for log file reading options
 */
export const readLogFileQuerySchema = z.object({
  // `offset + limit` sizes the reader's ring buffer, so both are bounded integers.
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  level: z.enum(["error", "warn", "info", "debug", "trace"]).optional(),
  // Any category a logger writes (`parser-text`, `achievement`, …) — the old
  // closed list could not filter for half of them. The shape bounds it.
  category: logCategory.optional(),
  search: z.string().max(200).optional(),
});

/**
 * Schema for parser settings
 */
export const parserSettingsSchema = z.object({
  globalOpenaiApiKey: z.string().optional().nullable(),
  globalClaudeApiKey: z.string().optional().nullable(),
  allowUserApiKeys: z.boolean().optional(),
  requireUserApiKeys: z.boolean().optional(),
});

// Type exports
export type LoggingConfigInput = z.infer<typeof loggingConfigSchema>;
export type ToggleDebugLoggingInput = z.infer<typeof toggleDebugLoggingSchema>;
export type ReadLogFileQuery = z.infer<typeof readLogFileQuerySchema>;
export type ParserSettingsInput = z.infer<typeof parserSettingsSchema>;
