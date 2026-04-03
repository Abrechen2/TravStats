import { z } from 'zod';

/**
 * Schema for logging configuration
 */
export const loggingConfigSchema = z.object({
  logLevel: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
  maxLogFileSize: z.number().min(1).max(100).optional(), // 1-100 MB
  maxLogFiles: z.number().min(1).max(30).optional(), // Keep 1-30 files
  logHttpRequests: z.boolean().optional(),
  logDatabaseQueries: z.boolean().optional(),
  logParserOperations: z.boolean().optional(),
  logRetentionDays: z.number().min(1).max(90).optional(), // 1-90 days
});

/**
 * Schema for toggling debug logging
 */
export const toggleDebugLoggingSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Schema for log file reading options
 */
export const readLogFileQuerySchema = z.object({
  offset: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
  category: z.enum(['general', 'http', 'database', 'parser', 'security', 'error', 'system']).optional(),
  search: z.string().max(200).optional(),
});

/**
 * Schema for log search query
 */
export const searchLogsQuerySchema = z.object({
  query: z.string().max(200).optional(),
  level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
  category: z.enum(['general', 'http', 'database', 'parser', 'security', 'error', 'system']).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

/**
 * Schema for parser settings
 */
export const parserSettingsSchema = z.object({
  globalOpenaiApiKey: z.string().optional().nullable(),
  globalClaudeApiKey: z.string().optional().nullable(),
  allowUserApiKeys: z.boolean().optional(),
  requireUserApiKeys: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
});

// Type exports
export type LoggingConfigInput = z.infer<typeof loggingConfigSchema>;
export type ToggleDebugLoggingInput = z.infer<typeof toggleDebugLoggingSchema>;
export type ReadLogFileQuery = z.infer<typeof readLogFileQuerySchema>;
export type SearchLogsQuery = z.infer<typeof searchLogsQuerySchema>;
export type ParserSettingsInput = z.infer<typeof parserSettingsSchema>;
