import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { prisma } from '../db';
import logger from '../utils/logger';
import { DATABASE_URL } from '../utils/database';
import { Backup } from '@prisma/client';

const execAsync = promisify(exec);

interface BackupOptions {
  type?: 'full' | 'partial';
  retentionDays?: number;
}

interface RestoreOptions {
  scope: 'full' | 'database' | 'files';
  createBackupBefore?: boolean;
  targetDatabaseUrl?: string;
}

// Use BACKUP_PATH from environment if set (e.g., in Docker: /app/data/backups)
// Otherwise use a platform-appropriate default
const BACKUP_BASE_DIR = process.env.BACKUP_PATH || (
  process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'backups')
    : '/app/data/backups'
);
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const DOCKER_DB_CONTAINER = process.env.DOCKER_DB_CONTAINER || 'travstats-db';
const DB_NAME = process.env.POSTGRES_DB || 'flights';
const DB_USER = process.env.POSTGRES_USER || 'flights';

// Ensure backup directory exists
// Wrap in try-catch to prevent startup failures if permissions are missing
try {
  if (!fs.existsSync(BACKUP_BASE_DIR)) {
    fs.mkdirSync(BACKUP_BASE_DIR, { recursive: true });
    logger.info({
      operation: 'backup_dir_created',
      message: `Created backup directory: ${BACKUP_BASE_DIR}`,
      context: { directory: BACKUP_BASE_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first backup attempt
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  logger.warn({ operation: 'backup_dir_creation_warning', message: `Could not create backup directory ${BACKUP_BASE_DIR}: ${errorMsg}` });
  logger.warn({ operation: 'backup_dir_creation_warning', message: 'Backups may fail until directory permissions are fixed' });
  logger.warn({
    operation: 'backup_dir_creation_failed',
    message: `Could not create backup directory: ${BACKUP_BASE_DIR}`,
    context: { directory: BACKUP_BASE_DIR, error: errorMsg },
  });
}

/**
 * Extract database connection info from DATABASE_URL
 * Uses URL class for robust parsing, especially with special characters in passwords
 */
function parseDatabaseUrl(url: string): { host: string; port: string; user: string; password: string; database: string } {
  try {
    // Replace postgresql:// with http:// for URL parsing (URL class doesn't support postgresql://)
    const httpUrl = url.replace(/^postgresql:\/\//, 'http://');
    const dbUrl = new URL(httpUrl);

    return {
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      host: dbUrl.hostname,
      port: dbUrl.port || '5432',
      database: dbUrl.pathname.slice(1), // Remove leading /
    };
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Execute pg_dump to create database backup
 */
async function createDatabaseDump(outputPath: string, targetDatabaseUrl?: string): Promise<void> {
  const dbUrl = targetDatabaseUrl || DATABASE_URL;
  const dbInfo = parseDatabaseUrl(dbUrl);

  // Check if we're in Docker or if database is in Docker
  const isDocker = process.env.DOCKER === 'true';
  const dbContainer = process.env.DOCKER_DB_CONTAINER || DOCKER_DB_CONTAINER;
  const isWindows = process.platform === 'win32';

  // Check if we're running inside Docker by checking for /.dockerenv or docker hostname
  const isRunningInDocker = fs.existsSync('/.dockerenv') ||
                            fs.existsSync('/proc/self/cgroup') &&
                            fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');

  // Check if database is in Docker (docker hostname) or localhost
  const isDockerHostname = dbInfo.host === 'db' || dbInfo.host === 'travstats-db-dev';
  const isLocalhost = dbInfo.host === 'localhost' || dbInfo.host === '127.0.0.1';

  // If database is not localhost and not a docker hostname, it's likely remote
  // In this case, we should use direct pg_dump connection, not docker exec
  const isRemoteDatabase = !isDockerHostname && !isLocalhost;

  logger.info({
    operation: 'backup_db_check',
    message: 'Checking database connection method',
    isDocker,
    isRunningInDocker,
    dbContainer,
    isWindows,
    dbHost: dbInfo.host,
    dbPort: dbInfo.port,
    isRemoteDatabase,
    isDockerHostname,
    isLocalhost,
  });

  // Only check for Docker if database is likely in Docker (docker hostname)
  // If database is remote or localhost (not docker hostname), skip Docker check and use direct connection
  let dockerCommandAvailable = false;
  let dockerDaemonRunning = false;

  if (isDockerHostname) {
    // Database might be in Docker, check if Docker is available
    try {
      await execAsync('docker --version');
      dockerCommandAvailable = true;
      logger.info({
        operation: 'backup_docker_command_available',
        message: 'Docker command is available',
      });

      // Check if Docker daemon is actually running
      try {
        await execAsync('docker ps');
        dockerDaemonRunning = true;
        logger.info({
          operation: 'backup_docker_daemon_running',
          message: 'Docker daemon is running',
        });
      } catch (error) {
        logger.warn({
          operation: 'backup_docker_daemon_not_running',
          message: 'Docker command available but daemon not running',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } catch (error) {
      logger.warn({
        operation: 'backup_docker_command_not_available',
        message: 'Docker command not available',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else {
    // Database is clearly remote, skip Docker check
    logger.info({
      operation: 'backup_db_remote',
      message: 'Database is remote, skipping Docker check',
      dbHost: dbInfo.host,
    });
  }

  // Try multiple container names (dev and prod)
  let dockerAvailable = false;
  let actualContainerName = dbContainer;

  if (dockerCommandAvailable && dockerDaemonRunning) {
    const possibleContainers = [
      dbContainer,
      'travstats-db-dev',
      'travstats-db',
    ];

    // Remove duplicates
    const uniqueContainers = [...new Set(possibleContainers.filter(c => c))];

    // If DB host is 'db' (Docker internal hostname), we're likely in Docker
    // and the container name might match the service name
    if (dbInfo.host === 'db' || dbInfo.host === 'travstats-db-dev') {
      logger.info({
        operation: 'backup_db_host_docker',
        message: 'Database host suggests Docker environment',
        dbHost: dbInfo.host,
      });
    }

    for (const container of uniqueContainers) {
      try {
        // First try to list all containers and search for matching names
        const allContainersResult = await execAsync('docker ps --format "{{.Names}}"');
        const allContainers = allContainersResult.stdout.trim().split('\n').filter(c => c);

        logger.debug({
          operation: 'backup_docker_list_containers',
          message: 'Listed all running containers',
          containers: allContainers,
          searchingFor: container,
        });

        // Check for exact match
        const exactMatch = allContainers.find(c => c === container);
        if (exactMatch) {
          actualContainerName = exactMatch;
          dockerAvailable = true;
          logger.info({
            operation: 'backup_docker_detected',
            message: 'Docker container detected (exact match), using docker exec',
            container: actualContainerName,
            checked: container,
          });
          break;
        }

        // Check for partial match (container name contains search term)
        const partialMatch = allContainers.find(c => c.includes(container) || container.includes(c));
        if (partialMatch) {
          actualContainerName = partialMatch;
          dockerAvailable = true;
          logger.info({
            operation: 'backup_docker_detected',
            message: 'Docker container detected (partial match), using docker exec',
            container: actualContainerName,
            checked: container,
          });
          break;
        }
      } catch (error) {
        // Continue to next container name
        logger.debug({
          operation: 'backup_docker_container_check',
          message: `Container ${container} not found`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue;
      }
    }
  }

  if (!dockerAvailable) {
    if (dockerCommandAvailable && !dockerDaemonRunning) {
      logger.warn({
        operation: 'backup_docker_daemon_not_running',
        message: 'Docker daemon not running, will try direct connection',
      });
    } else if (!dockerCommandAvailable) {
      logger.info({
        operation: 'backup_docker_not_available',
        message: 'Docker not available, will use direct connection',
      });
    } else {
      logger.warn({
        operation: 'backup_docker_check_failed',
        message: 'Docker container not found, will try direct connection',
        dockerCommandAvailable,
        dockerDaemonRunning,
        checkedContainers: ['travstats-db-dev', 'travstats-db', dbContainer].filter(c => c),
      });
    }
  }

  let command: string;
  const execOptions: { maxBuffer: number; env?: NodeJS.ProcessEnv; shell?: string } = {
    maxBuffer: 100 * 1024 * 1024, // 100MB buffer
  };

  // Set PGPASSWORD in environment for cross-platform compatibility
  execOptions.env = {
    ...process.env,
    PGPASSWORD: dbInfo.password,
  };

  // On Windows (non-Docker), use spawn with file output instead of shell redirection
  // But only if Docker is not available or database is remote
  if (isWindows && !dockerAvailable) {
    // If database is remote, we need pg_dump locally - this is expected
    if (isRemoteDatabase || !isDockerHostname) {
      logger.info({
        operation: 'backup_using_local_pg_dump',
        message: 'Using local pg_dump for remote database',
        dbHost: dbInfo.host,
      });
      // Continue with local pg_dump - this is expected for remote databases
    } else if (dockerCommandAvailable && dockerDaemonRunning && !dockerAvailable) {
      // Docker is running but container not found - this is unexpected
      const checkedContainers = [
        dbContainer,
        'travstats-db-dev',
        'travstats-db',
      ].filter(c => c);
      throw new Error(
        `Docker is available and running but database container not found. ` +
        `Checked containers: ${checkedContainers.join(', ')}. ` +
        `Please ensure the database container is running and the container name matches one of the expected names. ` +
        `You can set DOCKER_DB_CONTAINER environment variable to specify the correct container name.`
      );
    } else if (!dockerCommandAvailable || !dockerDaemonRunning) {
      // Docker not available or not running - we need pg_dump locally
      logger.info({
        operation: 'backup_docker_not_available_fallback',
        message: 'Docker not available, using local pg_dump',
        dockerCommandAvailable,
        dockerDaemonRunning,
      });
      // Continue with local pg_dump - this is expected if Docker is not available
    }

    return new Promise<void>((resolve, reject) => {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputFile = fs.createWriteStream(outputPath);
      const pgDump = spawn('pg_dump', [
        '-h', dbInfo.host,
        '-p', dbInfo.port.toString(),
        '-U', dbInfo.user,
        '-F', 'p',
        dbInfo.database,
      ], {
        env: {
          ...process.env,
          PGPASSWORD: dbInfo.password,
        },
      });

      pgDump.stdout.pipe(outputFile);

      let stderrData = '';
      pgDump.stderr.on('data', (data) => {
        stderrData += data.toString();
        logger.warn({
          operation: 'backup_db_stderr',
          message: 'pg_dump stderr output',
          data: data.toString(),
        });
      });

      pgDump.on('error', (error) => {
        outputFile.close();
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (unlinkError) {
          // Ignore unlink errors
        }
        reject(new Error(
          `Failed to start pg_dump: ${error.message}. ` +
          `Make sure pg_dump is installed and in your PATH, or use Docker for backups.`
        ));
      });

      outputFile.on('error', (error) => {
        pgDump.kill();
        reject(new Error(`Failed to write backup file: ${error.message}`));
      });

      pgDump.on('close', (code) => {
        outputFile.end(() => {
          if (code === 0) {
            // Verify file was created and has content
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              if (stats.size === 0) {
                reject(new Error('Backup file is empty'));
              } else {
                resolve();
              }
            } else {
              reject(new Error('Backup file was not created'));
            }
          } else {
            try {
              if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
              }
            } catch (unlinkError) {
              // Ignore unlink errors
            }
            reject(new Error(`pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
          }
        });
      });
    });
  }

  // Docker or Unix: use execAsync with shell redirection
  if (dockerAvailable) {
    // Use docker exec - this works on both Windows and Unix when database is in Docker
    // On Windows, we need to handle the output redirection differently
    if (isWindows) {
      // On Windows with Docker, use spawn with docker exec
      return new Promise<void>((resolve, reject) => {
        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFile = fs.createWriteStream(outputPath);
        const dockerExec = spawn('docker', [
          'exec',
          '-i',
          actualContainerName,
          'pg_dump',
          '-U', dbInfo.user,
          '-F', 'p',
          dbInfo.database,
        ], {
          env: {
            ...process.env,
            PGPASSWORD: dbInfo.password,
          },
        });

        dockerExec.stdout.pipe(outputFile);

        let stderrData = '';
        dockerExec.stderr.on('data', (data) => {
          stderrData += data.toString();
          logger.warn({
            operation: 'backup_db_docker_stderr',
            message: 'docker exec pg_dump stderr output',
            data: data.toString(),
          });
        });

        dockerExec.on('error', (error) => {
          outputFile.close();
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
            }
          } catch (unlinkError) {
            // Ignore unlink errors
          }
          reject(new Error(`Failed to start docker exec: ${error.message}`));
        });

        outputFile.on('error', (error) => {
          dockerExec.kill();
          reject(new Error(`Failed to write backup file: ${error.message}`));
        });

        dockerExec.on('close', (code) => {
          outputFile.end(() => {
            if (code === 0) {
              // Verify file was created and has content
              if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size === 0) {
                  reject(new Error('Backup file is empty'));
                } else {
                  resolve();
                }
              } else {
                reject(new Error('Backup file was not created'));
              }
            } else {
              try {
                if (fs.existsSync(outputPath)) {
                  fs.unlinkSync(outputPath);
                }
              } catch (unlinkError) {
                // Ignore unlink errors
              }
              reject(new Error(`docker exec pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
            }
          });
        });
      });
    } else {
      // Unix/Linux with Docker: use shell redirection
      command = `docker exec ${actualContainerName} pg_dump -U ${dbInfo.user} -F p ${dbInfo.database} > ${outputPath}`;
    }
  } else {
    // Direct connection (no Docker) - use environment variable instead of inline PGPASSWORD
    command = `pg_dump -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} -F p ${dbInfo.database} > ${outputPath}`;
  }

  // Only execute command if it was defined (not if we already returned a Promise)
  if (!command) {
    throw new Error('No backup command defined - this should not happen');
  }

  try {
    await execAsync(command, execOptions);
  } catch (error) {
    logger.error({
      operation: 'backup_db_error',
      message: 'Database backup failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(`Database backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Archive upload directories
 */
async function archiveUploads(outputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const uploadsDir = path.join(__dirname, '../../uploads');

    if (!fs.existsSync(uploadsDir)) {
      logger.warn({ operation: 'backup_files_missing', message: 'Uploads directory not found' });
      // Create empty archive
      const archive = archiver('tar', { gzip: true });
      const output = fs.createWriteStream(outputPath);

      archive.pipe(output);
      archive.finalize();

      output.on('close', () => resolve(0));
      output.on('error', reject);
      return;
    }

    const archive = archiver('tar', { gzip: true });
    const output = fs.createWriteStream(outputPath);

    archive.pipe(output);

    // Add all upload directories
    const dirs = ['receipts', 'emails', 'training'];
    dirs.forEach((dir) => {
      const dirPath = path.join(uploadsDir, dir);
      if (fs.existsSync(dirPath)) {
        archive.directory(dirPath, `uploads/${dir}`);
      }
    });

    archive.on('error', (err: Error) => {
      logger.error({
        operation: 'backup_files_error',
        message: 'File archive creation failed',
        error: err.message,
      });
      reject(err);
    });

    output.on('close', () => {
      resolve(archive.pointer());
    });

    archive.finalize();
  });
}

/**
 * Get metadata about current database state
 */
async function getMetadata(): Promise<Record<string, string | number>> {
  const [userCount, flightCount, airportCount, achievementCount] = await Promise.all([
    prisma.user.count(),
    prisma.flight.count(),
    prisma.airport.count(),
    prisma.achievement.count(),
  ]);

  return {
    userCount,
    flightCount,
    airportCount,
    achievementCount,
    timestamp: new Date().toISOString(),
    instanceName: process.env.INSTANCE_NAME || 'TravStats',
  };
}

/**
 * Create a new backup
 */
export async function createBackup(options: BackupOptions = {}): Promise<string> {
  logger.info({
    operation: 'backup_create_start',
    message: 'Starting backup creation',
    backupBaseDir: BACKUP_BASE_DIR,
    backupPathEnv: process.env.BACKUP_PATH,
    platform: process.platform,
    docker: process.env.DOCKER,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `backup-${timestamp}`;
  const backupDir = path.join(BACKUP_BASE_DIR, backupId);
  const tempDir = path.join(backupDir, 'temp');

  // Ensure backup base directory exists
  try {
    if (!fs.existsSync(BACKUP_BASE_DIR)) {
      logger.info({
        operation: 'backup_dir_creating',
        message: `Creating backup directory: ${BACKUP_BASE_DIR}`,
      });
      fs.mkdirSync(BACKUP_BASE_DIR, { recursive: true });
      logger.info({
        operation: 'backup_dir_created',
        message: `Created backup directory: ${BACKUP_BASE_DIR}`,
      });
    } else {
      logger.info({
        operation: 'backup_dir_exists',
        message: `Backup directory already exists: ${BACKUP_BASE_DIR}`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      operation: 'backup_dir_creation_failed',
      message: 'Failed to create backup directory',
      error: errorMessage,
      backupBaseDir: BACKUP_BASE_DIR,
      platform: process.platform,
    });
    throw new Error(`Failed to create backup directory: ${errorMessage}`);
  }

  // Create directories
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    logger.error({
      operation: 'backup_temp_dir_creation_failed',
      message: 'Failed to create temp directory',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(`Failed to create temp directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const dbBackupPath = path.join(tempDir, 'database.sql');
  const filesBackupPath = path.join(tempDir, 'uploads.tar.gz');
  const finalArchivePath = path.join(backupDir, `${backupId}.tar.gz`);

  // Create backup record
  let backup;
  try {
    logger.info({
      operation: 'backup_record_creation_start',
      message: 'Creating backup record in database',
      backupPath: finalArchivePath,
      backupDir,
    });

    backup = await prisma.backup.create({
      data: {
        type: options.type || 'full',
        status: 'running',
        backupPath: finalArchivePath,
        dbBackupPath,
        filesBackupPath,
        retentionDays: options.retentionDays || RETENTION_DAYS,
        startedAt: new Date(),
      },
    });

    logger.info({
      operation: 'backup_record_created',
      message: 'Backup record created successfully',
      backupId: backup.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      operation: 'backup_record_creation_failed',
      message: 'Failed to create backup record in database',
      error: errorMessage,
      stack: errorStack,
      backupPath: finalArchivePath,
      backupDir,
    });

    // Cleanup temp directory
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      logger.warn({
        operation: 'backup_cleanup_failed',
        message: 'Failed to cleanup temp directory after error',
        error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
      });
    }

    // Provide more specific error message
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      throw new Error(`Backup table does not exist. Please run database migrations: ${errorMessage}`);
    }

    throw new Error(`Failed to create backup record: ${errorMessage}`);
  }

  try {
    logger.info({
      operation: 'backup_start',
      message: 'Starting backup',
      backupId: backup.id,
    });

    // Step 1: Backup database
    logger.info({ operation: 'backup_db_start', message: 'Backing up database' });
    await createDatabaseDump(dbBackupPath);
    const dbSize = fs.statSync(dbBackupPath).size;

    // Step 2: Archive uploads
    logger.info({ operation: 'backup_files_start', message: 'Archiving upload files' });
    const filesSize = await archiveUploads(filesBackupPath);

    // Step 3: Get metadata
    const metadata = await getMetadata();

    // Step 4: Create final archive
    logger.info({ operation: 'backup_archive_start', message: 'Creating final archive' });
    await new Promise<void>((resolve, reject) => {
      const archive = archiver('tar', { gzip: true });
      const output = fs.createWriteStream(finalArchivePath);

      archive.pipe(output);
      archive.file(dbBackupPath, { name: 'database.sql' });
      archive.file(filesBackupPath, { name: 'uploads.tar.gz' });
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      archive.on('error', reject);
      output.on('close', resolve);
      archive.finalize();
    });

    const totalSize = fs.statSync(finalArchivePath).size;

    // Step 5: Cleanup temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Step 6: Update backup record
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: 'completed',
        size: BigInt(totalSize),
        completedAt: new Date(),
        metadata,
      },
    });

    logger.info({
      operation: 'backup_complete',
      message: 'Backup completed successfully',
      backupId: backup.id,
      size: totalSize,
    });

    return backup.id;
  } catch (error) {
    // Update backup record with error
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });

    // Cleanup on error
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      logger.error({
        operation: 'backup_cleanup_error',
        message: 'Failed to cleanup failed backup',
        error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
      });
    }

    logger.error({
      operation: 'backup_failed',
      message: 'Backup failed',
      backupId: backup.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * List all backups
 */
export async function listBackups(): Promise<Backup[]> {
  return prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get backup by ID
 */
export async function getBackup(id: string): Promise<Backup & { fileExists: boolean }> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new Error('Backup not found');
  }

  // Check if backup file still exists
  const exists = backup.backupPath ? fs.existsSync(backup.backupPath) : false;

  return {
    ...backup,
    fileExists: exists,
  };
}

/**
 * Delete backup
 */
export async function deleteBackup(id: string): Promise<void> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new Error('Backup not found');
  }

  // Delete backup files
  if (backup.backupPath && fs.existsSync(backup.backupPath)) {
    const backupDir = path.dirname(backup.backupPath);
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }

  // Delete database record
  await prisma.backup.delete({
    where: { id },
  });

  logger.info({
    operation: 'backup_deleted',
    message: 'Backup deleted',
    backupId: id,
  });
}

/**
 * Restore backup
 */
export async function restoreBackup(id: string, options: RestoreOptions): Promise<void> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new Error('Backup not found');
  }

  if (backup.status !== 'completed') {
    throw new Error('Backup is not completed');
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new Error('Backup file not found');
  }

  // Create backup before restore if requested
  if (options.createBackupBefore) {
    logger.info({
      operation: 'restore_backup_before',
      message: 'Creating backup before restore',
    });
    await createBackup({ type: 'full' });
  }

  const tempDir = path.join(BACKUP_BASE_DIR, 'restore-temp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract archive
    logger.info({ operation: 'restore_extract', message: 'Extracting backup archive' });
    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process');
      const tar = spawn('tar', ['-xzf', backup.backupPath, '-C', tempDir]);

      tar.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`tar extraction failed with code ${code}`));
        } else {
          resolve();
        }
      });

      tar.on('error', reject);
    });

    const dbBackupPath = path.join(tempDir, 'database.sql');
    const filesBackupPath = path.join(tempDir, 'uploads.tar.gz');

    // Restore database if requested
    if (options.scope === 'full' || options.scope === 'database') {
      if (!fs.existsSync(dbBackupPath)) {
        throw new Error('Database backup file not found in archive');
      }

      logger.info({ operation: 'restore_db', message: 'Restoring database' });
      const dbUrl = options.targetDatabaseUrl || DATABASE_URL;
      const dbInfo = parseDatabaseUrl(dbUrl);

      const isDocker = process.env.DOCKER === 'true';
      const dbContainer = process.env.DOCKER_DB_CONTAINER || DOCKER_DB_CONTAINER;

      let command: string;

      if (isDocker) {
        try {
          await execAsync(`docker ps --filter name=${dbContainer} --format "{{.Names}}"`);
          command = `cat ${dbBackupPath} | docker exec -i ${dbContainer} psql -U ${dbInfo.user} ${dbInfo.database}`;
        } catch (error) {
          // Use environment variable instead of inline PGPASSWORD for cross-platform support
          command = `psql -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} ${dbInfo.database} < ${dbBackupPath}`;
        }
      } else {
        // Use environment variable instead of inline PGPASSWORD for cross-platform support
        command = `psql -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} ${dbInfo.database} < ${dbBackupPath}`;
      }

      const isWindows = process.platform === 'win32';

      // On Windows, use spawn with file input instead of shell redirection
      if (isWindows && !isDocker) {
        await new Promise<void>((resolve, reject) => {
          const inputFile = fs.createReadStream(dbBackupPath);
          const psql = spawn('psql', [
            '-h', dbInfo.host,
            '-p', dbInfo.port.toString(),
            '-U', dbInfo.user,
            dbInfo.database,
          ], {
            env: {
              ...process.env,
              PGPASSWORD: dbInfo.password,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          inputFile.pipe(psql.stdin);
          psql.stdout.on('data', (data) => {
            // Log psql output for debugging
            logger.debug({
              operation: 'restore_db_stdout',
              message: 'psql stdout output',
              data: data.toString(),
            });
          });
          psql.stderr.on('data', (data) => {
            logger.warn({
              operation: 'restore_db_stderr',
              message: 'psql stderr output',
              data: data.toString(),
            });
          });

          psql.on('error', (error) => {
            reject(new Error(`Failed to start psql: ${error.message}`));
          });

          psql.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`psql exited with code ${code}`));
            }
          });
        });
      } else {
        // Use execAsync for Docker or Unix systems
        const execOptions: { env?: NodeJS.ProcessEnv } = {
          env: {
            ...process.env,
            PGPASSWORD: dbInfo.password,
          },
        };
        await execAsync(command, execOptions);
      }
      logger.info({ operation: 'restore_db_complete', message: 'Database restored' });
    }

    // Restore files if requested
    if (options.scope === 'full' || options.scope === 'files') {
      if (!fs.existsSync(filesBackupPath)) {
        logger.warn({ operation: 'restore_files_missing', message: 'Files backup not found in archive' });
      } else {
        logger.info({ operation: 'restore_files', message: 'Restoring files' });
        const uploadsDir = path.join(__dirname, '../../uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const tar = spawn('tar', ['-xzf', filesBackupPath, '-C', uploadsDir]);

          tar.on('close', (code: number) => {
            if (code !== 0) {
              reject(new Error(`tar extraction failed with code ${code}`));
            } else {
              resolve();
            }
          });

          tar.on('error', reject);
        });

        logger.info({ operation: 'restore_files_complete', message: 'Files restored' });
      }
    }

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    logger.info({
      operation: 'restore_complete',
      message: 'Backup restored successfully',
      backupId: id,
      scope: options.scope,
    });
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    logger.error({
      operation: 'restore_failed',
      message: 'Restore failed',
      backupId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Cleanup old backups based on retention policy
 */
export async function cleanupOldBackups(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const oldBackups = await prisma.backup.findMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
      status: 'completed',
    },
  });

  let deletedCount = 0;

  for (const backup of oldBackups) {
    try {
      await deleteBackup(backup.id);
      deletedCount++;
    } catch (error) {
      logger.error({
        operation: 'cleanup_backup_error',
        message: 'Failed to delete old backup',
        backupId: backup.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info({
    operation: 'cleanup_complete',
    message: 'Old backups cleaned up',
    deletedCount,
  });

  return deletedCount;
}
