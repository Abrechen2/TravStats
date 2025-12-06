import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import readline from 'readline';
import { systemLogger } from '../utils/logger';
import { getLoggingConfig } from './loggingConfig';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

/**
 * Log Manager Service
 *
 * Handles log file operations:
 * - List log files with metadata
 * - Read and filter log entries
 * - Delete log files
 * - Cleanup old logs based on retention policy
 * - Get statistics
 */

const LOG_DIR = path.join(process.cwd(), '..', 'data', 'logs');

export interface LogFileMetadata {
  filename: string;
  category: string;
  size: number;
  sizeFormatted: string;
  created: Date;
  modified: Date;
  entryCount?: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: Record<string, any>;
  performance?: Record<string, any>;
  error?: Record<string, any>;
  requestId?: string;
  [key: string]: any;
}

export interface ReadOptions {
  offset?: number;
  limit?: number;
  level?: string;
  category?: string;
  search?: string;
}

export interface LogStats {
  totalSize: number;
  totalSizeFormatted: string;
  fileCount: number;
  oldestLog?: string;
  newestLog?: string;
  categoryBreakdown: Record<string, number>;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Extract category from filename (e.g., "app-2025-12-06.log" => "app")
 */
function extractCategory(filename: string): string {
  const match = filename.match(/^([a-z]+)(-\d{4}-\d{2}-\d{2})?\.log/);
  return match ? match[1] : 'unknown';
}

/**
 * Validate filename to prevent path traversal attacks
 */
function validateFilename(filename: string): boolean {
  // Only allow alphanumeric, dash, dot (for .log extension)
  const validPattern = /^[a-zA-Z0-9\-\.]+\.log(\.gz)?$/;
  return validPattern.test(filename) && !filename.includes('..');
}

/**
 * Get full path to log file after validation
 */
function getLogFilePath(filename: string): string {
  if (!validateFilename(filename)) {
    throw new Error('Invalid filename: potential path traversal detected');
  }
  return path.join(LOG_DIR, filename);
}

/**
 * List all log files with metadata
 */
export async function listLogFiles(): Promise<LogFileMetadata[]> {
  try {
    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      return [];
    }

    const files = await readdir(LOG_DIR);
    const logFiles = files.filter((f) => f.endsWith('.log') || f.endsWith('.log.gz'));

    const metadata: LogFileMetadata[] = await Promise.all(
      logFiles.map(async (filename) => {
        const filepath = path.join(LOG_DIR, filename);
        const stats = await stat(filepath);

        return {
          filename,
          category: extractCategory(filename),
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          created: stats.birthtime,
          modified: stats.mtime,
        };
      })
    );

    // Sort by modified date (newest first)
    metadata.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    return metadata;
  } catch (error) {
    systemLogger.error({
      operation: 'list_log_files_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Read log file with filtering and pagination
 */
export async function readLogFile(filename: string, options: ReadOptions = {}): Promise<LogEntry[]> {
  const { offset = 0, limit = 100, level, category, search } = options;

  try {
    const filepath = getLogFilePath(filename);

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      throw new Error(`Log file not found: ${filename}`);
    }

    // Cannot read gzipped files directly (would need decompression)
    if (filename.endsWith('.gz')) {
      throw new Error('Cannot read compressed log files. Download and decompress first.');
    }

    const entries: LogEntry[] = [];
    let skipped = 0;
    let collected = 0;

    const fileStream = fs.createReadStream(filepath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry: LogEntry = JSON.parse(line);

        // Apply filters
        if (level && entry.level !== level) continue;
        if (category && entry.category !== category) continue;
        if (search && !JSON.stringify(entry).toLowerCase().includes(search.toLowerCase())) continue;

        // Apply pagination
        if (skipped < offset) {
          skipped++;
          continue;
        }

        if (collected >= limit) {
          break;
        }

        entries.push(entry);
        collected++;
      } catch (parseError) {
        // Skip malformed log lines
        continue;
      }
    }

    return entries;
  } catch (error) {
    systemLogger.error({
      operation: 'read_log_file_failed',
      context: {
        filename,
        options,
      },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Delete a specific log file
 */
export async function deleteLogFile(filename: string): Promise<void> {
  try {
    const filepath = getLogFilePath(filename);

    if (!fs.existsSync(filepath)) {
      throw new Error(`Log file not found: ${filename}`);
    }

    await unlink(filepath);

    systemLogger.info({
      operation: 'log_file_deleted',
      context: {
        filename,
      },
    });
  } catch (error) {
    systemLogger.error({
      operation: 'delete_log_file_failed',
      context: {
        filename,
      },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Cleanup old log files based on retention policy
 */
export async function cleanupOldLogs(): Promise<number> {
  try {
    const config = await getLoggingConfig();
    const retentionMs = config.logRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - retentionMs);

    const files = await listLogFiles();
    let deletedCount = 0;

    for (const file of files) {
      if (file.modified < cutoffDate) {
        try {
          await deleteLogFile(file.filename);
          deletedCount++;
        } catch (error) {
          // Log error but continue cleanup
          systemLogger.warn({
            operation: 'cleanup_file_failed',
            context: {
              filename: file.filename,
            },
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    }

    if (deletedCount > 0) {
      systemLogger.info({
        operation: 'log_cleanup_completed',
        context: {
          deletedCount,
          retentionDays: config.logRetentionDays,
        },
      });
    }

    return deletedCount;
  } catch (error) {
    systemLogger.error({
      operation: 'cleanup_old_logs_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Get logging statistics
 */
export async function getLogStats(): Promise<LogStats> {
  try {
    const files = await listLogFiles();

    if (files.length === 0) {
      return {
        totalSize: 0,
        totalSizeFormatted: '0 B',
        fileCount: 0,
        categoryBreakdown: {},
      };
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const categoryBreakdown: Record<string, number> = {};

    files.forEach((file) => {
      if (!categoryBreakdown[file.category]) {
        categoryBreakdown[file.category] = 0;
      }
      categoryBreakdown[file.category]++;
    });

    // Sort files by modified date
    files.sort((a, b) => a.modified.getTime() - b.modified.getTime());

    return {
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      fileCount: files.length,
      oldestLog: files[0]?.filename,
      newestLog: files[files.length - 1]?.filename,
      categoryBreakdown,
    };
  } catch (error) {
    systemLogger.error({
      operation: 'get_log_stats_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Search across all log files (expensive operation, use sparingly)
 */
export async function searchLogs(query: {
  query?: string;
  level?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<LogEntry[]> {
  try {
    const files = await listLogFiles();
    const results: LogEntry[] = [];

    // Filter files by date range
    let filesToSearch = files;
    if (query.startDate || query.endDate) {
      filesToSearch = files.filter((file) => {
        if (query.startDate && file.modified < query.startDate) return false;
        if (query.endDate && file.modified > query.endDate) return false;
        return true;
      });
    }

    // Search each file (limit to 10 files to prevent abuse)
    for (const file of filesToSearch.slice(0, 10)) {
      if (file.filename.endsWith('.gz')) continue; // Skip compressed files

      const entries = await readLogFile(file.filename, {
        limit: 1000, // Max 1000 entries per file
        level: query.level,
        category: query.category,
        search: query.query,
      });

      results.push(...entries);

      // Limit total results to 1000
      if (results.length >= 1000) {
        break;
      }
    }

    return results;
  } catch (error) {
    systemLogger.error({
      operation: 'search_logs_failed',
      context: {
        query,
      },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Get path to log file (for download endpoints)
 */
export function getLogFilePathForDownload(filename: string): string {
  return getLogFilePath(filename);
}
