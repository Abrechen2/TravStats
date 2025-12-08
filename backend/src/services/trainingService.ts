import { prisma } from '../db';
import logger from '../utils/logger';
import { createTrainingExample, Annotation } from './annotationService';
import { ParsedBooking } from '../bookingParser';
import { getHardwareInfo } from './hardwareService';
import * as fs from 'fs';
import * as path from 'path';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Store for running training processes to allow cancellation
const runningProcesses = new Map<string, ChildProcess>();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const TRAINING_MODEL_NAME = 'travstats-custom';
const TRAINING_DATA_DIR = path.join(__dirname, '../../data/training');
const TRAINING_LOGS_DIR = path.join(__dirname, '../../data/logs/training');

// Python command detection - works both locally and in Docker
// Use environment variable if set, otherwise use generic python3/python
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const IS_DOCKER = fs.existsSync('/.dockerenv') || process.env.DOCKER === 'true';

// Ensure directories exist
if (!fs.existsSync(TRAINING_DATA_DIR)) {
  fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TRAINING_LOGS_DIR)) {
  fs.mkdirSync(TRAINING_LOGS_DIR, { recursive: true });
}

/**
 * Prepare training data in LoRA format (JSONL)
 */
export async function prepareTrainingData(trainingDataIds: string[]): Promise<string> {
  const trainingData = await prisma.trainingData.findMany({
    where: {
      id: { in: trainingDataIds },
      status: 'pending',
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  if (trainingData.length === 0) {
    throw new Error('No pending training data found');
  }

  const examples: any[] = [];

  for (const data of trainingData) {
    try {
      const annotation = data.annotations as unknown as Annotation;
      const extractedData = data.extractedData as unknown as ParsedBooking[];

      const example = createTrainingExample(annotation, extractedData);

      // Format for LoRA training (instruction-following format)
      examples.push({
        instruction: `Extract flight information from the following ${annotation.type === 'email' ? 'email' : 'boarding pass'}:`,
        input: example.input,
        output: example.output,
        metadata: {
          ...example.metadata,
          trainingDataId: data.id,
        },
      });
    } catch (error) {
      logger.error({
        operation: 'prepare_training_data_error',
        message: 'Failed to prepare training example',
        context: {
          trainingDataId: data.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  // Write to JSONL file
  const timestamp = Date.now();
  const jsonlPath = path.join(TRAINING_DATA_DIR, `training-${timestamp}.jsonl`);

  const jsonlContent = examples.map((ex) => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(jsonlPath, jsonlContent, 'utf-8');

  logger.info({
    operation: 'prepare_training_data',
    message: 'Training data prepared',
    context: {
      exampleCount: examples.length,
      jsonlPath,
    },
  });

  return jsonlPath;
}

/**
 * Log training event to database
 */
async function logTrainingEvent(
  trainingJobId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  metadata?: Record<string, any>
) {
  try {
    await prisma.trainingLog.create({
      data: {
        trainingJobId,
        level,
        message,
        metadata: metadata || {},
      },
    });
  } catch (error) {
    logger.error({
      operation: 'log_training_event_error',
      message: 'Failed to log training event',
      context: {
        trainingJobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Find the last successful training job and return its model path
 * Returns null if no successful training exists
 */
async function findLastSuccessfulTraining(): Promise<string | null> {
  try {
    const lastJob = await prisma.trainingJob.findFirst({
      where: {
        status: 'completed',
      },
      orderBy: {
        completedAt: 'desc',
      },
      select: {
        id: true,
        metrics: true,
      },
    });

    if (!lastJob) {
      return null;
    }

    // Try to get modelPath from metrics first
    const metrics = lastJob.metrics as any;
    if (metrics && metrics.modelPath && typeof metrics.modelPath === 'string') {
      const modelPath = metrics.modelPath;
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }

    // Fallback: construct path from job ID
    const modelPath = path.join(TRAINING_DATA_DIR, `output-${lastJob.id}`);
    if (fs.existsSync(modelPath)) {
      return modelPath;
    }

    return null;
  } catch (error) {
    logger.warn({
      operation: 'find_last_successful_training_error',
      message: 'Failed to find last successful training',
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Train model using LoRA
 */
export async function trainModel(
  trainingJobId: string,
  jsonlPath: string
): Promise<{ modelPath: string; metrics: Record<string, any> }> {
  await logTrainingEvent(trainingJobId, 'info', 'Starting LoRA training', {
    jsonlPath,
    baseModel: OLLAMA_MODEL,
  });

  // Python script path - works both in development and production (Docker)
  // In production, the script is copied to dist/scripts/
  // In development, it's in src/scripts/
  const pythonScript = IS_DOCKER
    ? path.join(__dirname, '../scripts/trainLora.py')  // Docker: dist/scripts/trainLora.py
    : path.join(__dirname, '../scripts/trainLora.py'); // Local: dist/scripts/trainLora.py (after build)

  // Fallback to source location for development
  const devScriptPath = path.join(__dirname, '../../src/scripts/trainLora.py');
  const finalScriptPath = fs.existsSync(pythonScript) ? pythonScript : devScriptPath;

  if (!fs.existsSync(finalScriptPath)) {
    throw new Error(`LoRA training script not found at ${finalScriptPath} or ${pythonScript}. Please ensure trainLora.py exists.`);
  }

  const logFile = path.join(TRAINING_LOGS_DIR, `training-${trainingJobId}.log`);
  const outputDir = path.join(TRAINING_DATA_DIR, `output-${trainingJobId}`);

  try {
    // Find previous successful training to continue from
    const previousModelPath = await findLastSuccessfulTraining();
    const isContinuingTraining = previousModelPath !== null;

    if (isContinuingTraining) {
      await logTrainingEvent(trainingJobId, 'info', 'Continuing training from previous model', {
        previousModelPath,
      });
      logger.info({
        operation: 'training_continue',
        message: 'Continuing training from previous model',
        context: {
          trainingJobId,
          previousModelPath,
        },
      });
    } else {
      await logTrainingEvent(trainingJobId, 'info', 'Starting new training from base model', {
        baseModel: OLLAMA_MODEL,
      });
      logger.info({
        operation: 'training_new',
        message: 'Starting new training from base model',
        context: {
          trainingJobId,
          baseModel: OLLAMA_MODEL,
        },
      });
    }

    // Get hardware info before training (for logging only)
    let hardwareInfo;
    try {
      hardwareInfo = await getHardwareInfo();

      // Log hardware info
      await logTrainingEvent(trainingJobId, 'info', 'Hardware information', {
        cpu: hardwareInfo.cpu,
        gpu: hardwareInfo.gpu,
        python: hardwareInfo.python,
        docker: hardwareInfo.docker,
        trainingAccess: hardwareInfo.trainingAccess,
      });

      logger.info({
        operation: 'training_hardware_info',
        message: 'Hardware info for training',
        context: {
          trainingJobId,
          hardwareInfo,
        },
      });
    } catch (error) {
      logger.warn({
        operation: 'training_hardware_info_error',
        message: 'Failed to get hardware info, continuing with defaults',
        context: {
          trainingJobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Run Python training script with log file parameter for real-time logging
    // Batch size will be auto-determined by Python script
    const previousModelArg = previousModelPath ? ` --previous-model-path "${previousModelPath}"` : '';
    const command = `${PYTHON_CMD} "${finalScriptPath}" --input "${jsonlPath}" --output "${outputDir}" --base-model "${OLLAMA_MODEL}" --job-id "${trainingJobId}" --log-file "${logFile}"${previousModelArg}`;

    await logTrainingEvent(trainingJobId, 'info', 'Executing training command', {
      command,
      pythonCmd: PYTHON_CMD,
      isDocker: IS_DOCKER,
      scriptPath: finalScriptPath,
      logFile,
      previousModelPath: previousModelPath || undefined,
      isContinuingTraining,
      hardwareInfo: hardwareInfo ? {
        cpu: hardwareInfo.cpu,
        gpu: hardwareInfo.gpu,
      } : undefined,
    });

    logger.info({
      operation: 'train_model_command',
      message: 'Executing training command',
      context: {
        command,
        pythonCmd: PYTHON_CMD,
        isDocker: IS_DOCKER,
        trainingJobId,
        scriptPath: finalScriptPath,
        logFile,
      },
    });

    // Execute command with process tracking for cancellation
    let childProcess: ChildProcess | null = null;
    const execPromise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      childProcess = exec(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }, (error, stdout, stderr) => {
        runningProcesses.delete(trainingJobId);
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });

      // Store process for potential cancellation (with PID for better tracking)
      if (childProcess && childProcess.pid) {
        runningProcesses.set(trainingJobId, childProcess);
        logger.info({
          operation: 'training_process_started',
          message: 'Training process started and tracked',
          context: {
            trainingJobId,
            pid: childProcess.pid,
            command: command.substring(0, 100), // Log first 100 chars
          },
        });
      }

      // Set timeout
      const os = require('os');
      const platform = os.platform();
      const timeoutId = setTimeout(() => {
        if (childProcess && !childProcess.killed) {
          runningProcesses.delete(trainingJobId);
          if (platform === 'win32') {
            // Windows: Kill process tree
            if (childProcess.pid) {
              try {
                const { execSync } = require('child_process');
                execSync(`taskkill /F /T /PID ${childProcess.pid}`, { stdio: 'ignore' });
              } catch (e) {
                try {
                  childProcess.kill('SIGKILL');
                } catch (killError) {
                  // Process already dead
                }
              }
            } else {
              try {
                childProcess.kill('SIGKILL');
              } catch (killError) {
                // Process already dead
              }
            }
          } else {
            try {
              childProcess.kill('SIGKILL');
            } catch (killError) {
              // Process already dead
            }
          }
          reject(new Error('Training timeout after 30 minutes'));
        }
      }, 30 * 60 * 1000); // 30 minutes timeout

      // Clear timeout if process completes
      if (childProcess) {
        childProcess.on('exit', () => {
          clearTimeout(timeoutId);
        });
      }
    });

    const { stdout, stderr } = await execPromise;

    // Logs are already written to file by Python script, but append stdout/stderr as well
    if (stdout || stderr) {
      const additionalLogs = (stdout ? stdout + '\n' : '') + (stderr ? stderr : '');
      if (additionalLogs.trim()) {
        fs.appendFileSync(logFile, '\n--- Additional Output ---\n' + additionalLogs, 'utf-8');
      }
    }

    await logTrainingEvent(trainingJobId, 'info', 'Training completed', {
      logFile,
      outputDir,
      hardwareInfo: hardwareInfo ? {
        cpu: hardwareInfo.cpu,
        gpu: hardwareInfo.gpu,
      } : undefined,
    });

    // Parse metrics from output (would need to be implemented in Python script)
    const metrics: Record<string, any> = {
      status: 'completed',
      logFile,
      hardwareInfo: hardwareInfo ? {
        cpu: hardwareInfo.cpu,
        gpu: hardwareInfo.gpu,
      } : undefined,
    };

    return {
      modelPath: outputDir,
      metrics,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logTrainingEvent(trainingJobId, 'error', 'Training failed', {
      error: errorMessage,
    });

    // Write error to log file
    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, `\nERROR: ${errorMessage}\n`, 'utf-8');
    } else {
      fs.writeFileSync(logFile, `ERROR: ${errorMessage}\n`, 'utf-8');
    }

    throw error;
  }
}

/**
 * Export trained model to Ollama
 */
export async function exportToOllama(
  trainingJobId: string,
  modelPath: string
): Promise<void> {
  await logTrainingEvent(trainingJobId, 'info', 'Exporting model to Ollama', { modelPath });

  try {
    // Create Modelfile for Ollama
    const modelfilePath = path.join(modelPath, 'Modelfile');
    const modelfileContent = `FROM ${OLLAMA_MODEL}

PARAMETER temperature 0.1
PARAMETER top_p 0.9

SYSTEM """You are a specialized flight booking email and boarding pass parser. Extract flight information accurately from emails and boarding passes. Return JSON format with flight details."""
`;

    fs.writeFileSync(modelfilePath, modelfileContent, 'utf-8');

    // Import to Ollama (this would need the actual GGUF file)
    // For now, we'll just log the command that would be run
    const command = `ollama create ${TRAINING_MODEL_NAME} -f "${modelfilePath}"`;

    await logTrainingEvent(trainingJobId, 'info', 'Ollama import command prepared', { command });

    // In production, this would actually run:
    // await execAsync(command);

    // For now, we'll just log it
    logger.info({
      operation: 'export_to_ollama',
      message: 'Model export prepared (not executed in development)',
      context: {
        trainingJobId,
        command,
      },
    });

    await logTrainingEvent(trainingJobId, 'info', 'Model exported to Ollama', {
      modelName: TRAINING_MODEL_NAME,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logTrainingEvent(trainingJobId, 'error', 'Failed to export model to Ollama', {
      error: errorMessage,
    });
    throw error;
  }
}

/**
 * Check if training should be triggered automatically
 */
export async function shouldTriggerTraining(): Promise<boolean> {
  // Check if there are enough pending training data entries (5-10)
  const pendingCount = await prisma.trainingData.count({
    where: { status: 'pending' },
  });

  // Check if there's already a running or pending job
  const activeJob = await prisma.trainingJob.findFirst({
    where: {
      status: { in: ['pending', 'running'] },
    },
  });

  if (activeJob) {
    return false; // Don't trigger if there's already a job running
  }

  // Trigger if we have at least 5 pending entries
  return pendingCount >= 5;
}

/**
 * Trigger training job
 */
export async function triggerTraining(): Promise<string> {
  // Check if training should be triggered
  if (!(await shouldTriggerTraining())) {
    const pendingCount = await prisma.trainingData.count({
      where: { status: 'pending' },
    });
    
    // Check if there's already a running or pending job
    const activeJob = await prisma.trainingJob.findFirst({
      where: {
        status: { in: ['pending', 'running'] },
      },
    });
    
    if (activeJob) {
      throw new Error(`Training job already in progress (status: ${activeJob.status}). Please wait for it to complete.`);
    }
    
    throw new Error(`Not enough training data. Need at least 5, have ${pendingCount}`);
  }

  // Get pending training data
  const pendingData = await prisma.trainingData.findMany({
    where: { status: 'pending' },
    take: 10, // Limit to 10 entries per batch
    orderBy: { createdAt: 'asc' },
  });

  if (pendingData.length === 0) {
    throw new Error('No pending training data found');
  }

  // Create training job
  const trainingJob = await prisma.trainingJob.create({
    data: {
      status: 'pending',
      trainingDataIds: pendingData.map((d) => d.id),
      modelName: TRAINING_MODEL_NAME,
    },
  });

  // Start training asynchronously
  processTrainingJob(trainingJob.id).catch((error) => {
    logger.error({
      operation: 'trigger_training_error',
      message: 'Failed to process training job',
      context: {
        trainingJobId: trainingJob.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  });

  return trainingJob.id;
}

/**
 * Process training job (runs asynchronously)
 */
async function processTrainingJob(trainingJobId: string): Promise<void> {
  try {
    // Update job status to running
    await prisma.trainingJob.update({
      where: { id: trainingJobId },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    const job = await prisma.trainingJob.findUnique({
      where: { id: trainingJobId },
    });

    if (!job) {
      throw new Error('Training job not found');
    }

    // Prepare training data
    const jsonlPath = await prepareTrainingData(job.trainingDataIds);

    // Train model
    const { modelPath, metrics } = await trainModel(trainingJobId, jsonlPath);

    // Export to Ollama
    await exportToOllama(trainingJobId, modelPath);

    // Update training data status
    await prisma.trainingData.updateMany({
      where: {
        id: { in: job.trainingDataIds },
      },
      data: {
        status: 'trained',
        trainedAt: new Date(),
      },
    });

    // Update job status to completed
    const logFile = path.join(TRAINING_LOGS_DIR, `training-${trainingJobId}.log`);
    await prisma.trainingJob.update({
      where: { id: trainingJobId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        logFile,
        metrics,
      },
    });

    logger.info({
      operation: 'process_training_job',
      message: 'Training job completed successfully',
      context: {
        trainingJobId,
        modelPath,
      },
    });
  } catch (error) {
    // Clean up process tracking on error
    runningProcesses.delete(trainingJobId);

    // Check if job was cancelled
    const job = await prisma.trainingJob.findUnique({
      where: { id: trainingJobId },
    });

    if (job?.status === 'cancelled') {
      // Job was cancelled, don't update to failed
      return;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await prisma.trainingJob.update({
      where: { id: trainingJobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage,
      },
    });

    logger.error({
      operation: 'process_training_job_error',
      message: 'Training job failed',
      context: {
        trainingJobId,
        error: errorMessage,
      },
    });
  }
}

/**
 * Cancel a running training job
 */
export async function cancelTraining(trainingJobId: string): Promise<void> {
  // Check if job exists and is running
  const job = await prisma.trainingJob.findUnique({
    where: { id: trainingJobId },
  });

  if (!job) {
    throw new Error('Training job not found');
  }

  if (job.status !== 'running' && job.status !== 'pending') {
    throw new Error(`Cannot cancel job with status: ${job.status}`);
  }

  // First, update status to indicate cancellation is in progress
  await prisma.trainingJob.update({
    where: { id: trainingJobId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
      errorMessage: 'Training cancelled by user',
    },
  });

  await logTrainingEvent(trainingJobId, 'info', 'Training cancellation initiated by user', {});

  // Kill the process if it's running
  const trackedProcess = runningProcesses.get(trainingJobId);
  let processKilled = false;

  if (trackedProcess && trackedProcess.pid) {
    try {
      const os = require('os');
      const platform = os.platform();
      const { execSync, spawn } = require('child_process');

      if (platform === 'win32') {
        // Windows: Kill process tree using taskkill
        try {
          // First try graceful shutdown with SIGTERM (if supported)
          try {
            trackedProcess.kill('SIGTERM');
            // Wait a bit for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e) {
            // SIGTERM might not work on Windows, continue to force kill
          }

          // Force kill process tree
          execSync(`taskkill /F /T /PID ${trackedProcess.pid}`, { 
            stdio: 'ignore',
            timeout: 5000,
          });
          processKilled = true;
          logger.info({
            operation: 'cancel_training_process_killed',
            message: 'Training process killed successfully (Windows)',
            context: {
              trainingJobId,
              pid: trackedProcess.pid,
            },
          });
        } catch (killError: any) {
          // If taskkill fails, try alternative methods
          logger.warn({
            operation: 'cancel_training_taskkill_failed',
            message: 'taskkill failed, trying alternative methods',
            context: {
              trainingJobId,
              pid: trackedProcess.pid,
              error: killError instanceof Error ? killError.message : 'Unknown error',
            },
          });

          // Try wmic as fallback
          try {
            execSync(`wmic process where "ProcessId=${trackedProcess.pid}" delete`, { 
              stdio: 'ignore',
              timeout: 5000,
            });
            processKilled = true;
          } catch (wmicError) {
            // Last resort: try to kill directly
            try {
              trackedProcess.kill('SIGKILL');
              processKilled = true;
            } catch (finalError) {
              logger.warn({
                operation: 'cancel_training_all_methods_failed',
                message: 'All kill methods failed for tracked process',
                context: {
                  trainingJobId,
                  pid: trackedProcess.pid,
                },
              });
            }
          }
        }
      } else {
        // Unix-like: Try graceful shutdown first (SIGTERM)
        try {
          trackedProcess.kill('SIGTERM');
          processKilled = true;

          // Wait for graceful shutdown, then force kill if still running
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check if process is still alive and force kill if needed
          try {
            // Try to send signal 0 to check if process exists
            process.kill(0);
            // Process still exists, force kill
            trackedProcess.kill('SIGKILL');
            logger.info({
              operation: 'cancel_training_force_killed',
              message: 'Training process force killed after SIGTERM (Unix)',
              context: {
                trainingJobId,
                pid: trackedProcess.pid,
              },
            });
          } catch (checkError) {
            // Process already dead, good
            logger.info({
              operation: 'cancel_training_graceful_shutdown',
              message: 'Training process shut down gracefully (Unix)',
              context: {
                trainingJobId,
                pid: trackedProcess.pid,
              },
            });
          }
        } catch (error) {
          logger.warn({
            operation: 'cancel_training_sigterm_failed',
            message: 'SIGTERM failed, trying SIGKILL',
            context: {
              trainingJobId,
              pid: trackedProcess.pid,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
          
          try {
            trackedProcess.kill('SIGKILL');
            processKilled = true;
          } catch (killError) {
            logger.warn({
              operation: 'cancel_training_kill_failed',
              message: 'Failed to kill tracked process',
              context: {
                trainingJobId,
                pid: trackedProcess.pid,
              },
            });
          }
        }
      }
    } catch (error) {
      logger.warn({
        operation: 'cancel_training_process_error',
        message: 'Failed to kill training process',
        context: {
          trainingJobId,
          pid: trackedProcess.pid,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    runningProcesses.delete(trainingJobId);
  }

  // If process wasn't in tracking map or kill failed, try to find and kill by job ID
  if (!processKilled) {
    logger.warn({
      operation: 'cancel_training_process_not_found',
      message: 'Training process not found in tracking map, attempting to find and kill by job ID',
      context: {
        trainingJobId,
      },
    });

    try {
      const { execSync } = require('child_process');
      const os = require('os');
      const platform = os.platform();

      if (platform === 'win32') {
        // Windows: Find Python processes with the job ID in command line
        // Try multiple methods to find and kill the process
        const methods = [
          // Method 1: wmic with job ID
          () => {
            try {
              execSync(`wmic process where "commandline like '%${trainingJobId}%'" delete`, { 
                stdio: 'ignore',
                timeout: 5000,
              });
              return true;
            } catch {
              return false;
            }
          },
          // Method 2: taskkill with filter
          () => {
            try {
              execSync(`taskkill /F /FI "IMAGENAME eq python.exe" /FI "COMMANDLINE eq *${trainingJobId}*" /T`, { 
                stdio: 'ignore',
                timeout: 5000,
              });
              return true;
            } catch {
              return false;
            }
          },
          // Method 3: taskkill with py.exe
          () => {
            try {
              execSync(`taskkill /F /FI "IMAGENAME eq py.exe" /FI "COMMANDLINE eq *${trainingJobId}*" /T`, { 
                stdio: 'ignore',
                timeout: 5000,
              });
              return true;
            } catch {
              return false;
            }
          },
        ];

        for (const method of methods) {
          if (method()) {
            processKilled = true;
            logger.info({
              operation: 'cancel_training_found_and_killed',
              message: 'Training process found and killed by job ID (Windows)',
              context: {
                trainingJobId,
              },
            });
            break;
          }
        }
      } else {
        // Unix: Find and kill Python processes
        try {
          execSync(`pkill -f "trainLora.py.*${trainingJobId}"`, { 
            stdio: 'ignore',
            timeout: 5000,
          });
          processKilled = true;
          logger.info({
            operation: 'cancel_training_found_and_killed',
            message: 'Training process found and killed by job ID (Unix)',
            context: {
              trainingJobId,
            },
          });
        } catch (pkillError) {
          // Try with pgrep first to find PID, then kill
          try {
            const { execSync } = require('child_process');
            const pids = execSync(`pgrep -f "trainLora.py.*${trainingJobId}"`, { encoding: 'utf-8' })
              .trim()
              .split('\n')
              .filter(pid => pid.trim());
            
            for (const pid of pids) {
              try {
                execSync(`kill -TERM ${pid}`, { stdio: 'ignore', timeout: 2000 });
                setTimeout(() => {
                  try {
                    execSync(`kill -KILL ${pid}`, { stdio: 'ignore', timeout: 2000 });
                  } catch {
                    // Process already dead
                  }
                }, 2000);
                processKilled = true;
              } catch {
                // Continue to next PID
              }
            }
          } catch {
            // All methods failed
          }
        }
      }
    } catch (findError) {
      logger.warn({
        operation: 'cancel_training_find_process_error',
        message: 'Failed to find and kill process by job ID',
        context: {
          trainingJobId,
          error: findError instanceof Error ? findError.message : 'Unknown error',
        },
      });
    }
  }

  await logTrainingEvent(trainingJobId, 'info', 'Training cancellation completed', {
    processKilled,
  });

  logger.info({
    operation: 'cancel_training',
    message: 'Training cancelled successfully',
    context: {
      trainingJobId,
      processKilled,
    },
  });
}

/**
 * Cleanup stale jobs that were running when the server shut down
 */
export async function cleanupStaleJobs(): Promise<void> {
  try {
    const staleJobs = await prisma.trainingJob.findMany({
      where: {
        status: { in: ['running', 'pending'] },
      },
    });

    if (staleJobs.length > 0) {
      logger.info({
        operation: 'cleanup_stale_jobs',
        message: `Found ${staleJobs.length} stale jobs`,
        context: {
          jobIds: staleJobs.map((j) => j.id),
        },
      });

      for (const job of staleJobs) {
        // Double check if process is actually running using local map
        // If we just restarted, the map is empty, so this is correct.
        if (runningProcesses.has(job.id)) {
          continue;
        }

        await prisma.trainingJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: 'Training interrupted (server restart)',
          },
        });

        await logTrainingEvent(job.id, 'error', 'Training interrupted by server restart', {});
      }
    }
  } catch (error) {
    logger.error('Failed to cleanup stale jobs:', error);
  }
}

// Run cleanup on startup to catch jobs that were abandoned
cleanupStaleJobs().catch(e => console.error('Failed to cleanup stale jobs:', e));

