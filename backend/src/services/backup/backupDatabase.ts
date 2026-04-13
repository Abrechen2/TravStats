import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';
import { DATABASE_URL } from '../../utils/database';
import { DOCKER_DB_CONTAINER } from './backupConfig';

const execAsync = promisify(exec);

/**
 * Extract database connection info from DATABASE_URL
 * Uses URL class for robust parsing, especially with special characters in passwords
 */
export function parseDatabaseUrl(url: string): { host: string; port: string; user: string; password: string; database: string } {
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
export async function createDatabaseDump(outputPath: string, targetDatabaseUrl?: string): Promise<void> {
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
        } catch (_unlinkError) {
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
            } catch (_unlinkError) {
              // Ignore unlink errors
            }
            reject(new Error(`pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
          }
        });
      });
    });
  }

  // Docker: use spawn with file output (safe from command injection)
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
          } catch (_unlinkError) {
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
              } catch (_unlinkError) {
                // Ignore unlink errors
              }
              reject(new Error(`docker exec pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
            }
          });
        });
      });
    } else {
      // Unix/Linux with Docker: use spawn (no shell) to prevent command injection
      return new Promise<void>((resolve, reject) => {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFile = fs.createWriteStream(outputPath);
        const dockerExec = spawn('docker', [
          'exec', '-i', actualContainerName,
          'pg_dump', '-U', dbInfo.user, '-F', 'p', dbInfo.database,
        ], {
          env: { ...process.env, PGPASSWORD: dbInfo.password },
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
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
          reject(new Error(`Failed to start docker exec: ${error.message}`));
        });

        outputFile.on('error', (error) => {
          dockerExec.kill();
          reject(new Error(`Failed to write backup file: ${error.message}`));
        });

        dockerExec.on('close', (code) => {
          outputFile.end(() => {
            if (code === 0) {
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
              try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
              reject(new Error(`docker exec pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
            }
          });
        });
      });
    }
  } else {
    // Direct connection (no Docker), Unix: use spawn (no shell) to prevent command injection
    return new Promise<void>((resolve, reject) => {
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
        env: { ...process.env, PGPASSWORD: dbInfo.password },
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
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
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
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
            reject(new Error(`pg_dump exited with code ${code}${stderrData ? ': ' + stderrData : ''}`));
          }
        });
      });
    });
  }
}
