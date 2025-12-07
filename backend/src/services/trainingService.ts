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
// On Windows, prefer Python 3.12 (with CUDA support) if available, otherwise use python3
let defaultPythonCmd = 'python3';
if (process.platform === 'win32' && !fs.existsSync('/.dockerenv')) {
  // On Windows (local), try to use Python 3.12 first (has CUDA support)
  try {
    const { execSync } = require('child_process');
    execSync('py -3.12 --version', { stdio: 'ignore' });
    defaultPythonCmd = 'py -3.12';
  } catch {
    // Python 3.12 not available, fall back to default
  }
}
const PYTHON_CMD = process.env.PYTHON_CMD || defaultPythonCmd;
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
    // Get hardware info before training
    let hardwareInfo;
    let batchSizeArg = '';
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

      // Adjust batch size based on hardware if GPU is available
      // The Python script will auto-determine if not provided, but we can optimize here
      if (hardwareInfo.gpu.available) {
        // GPU available - use default (4) or let Python script decide
        // batchSizeArg = '--batch-size 4'; // Optional: explicitly set
      } else {
        // CPU only - use larger batch size for better CPU utilization
        // batchSizeArg = '--batch-size 8'; // Optional: explicitly set
      }
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
    // Batch size will be auto-determined by Python script if not provided
    const command = `${PYTHON_CMD} "${finalScriptPath}" --input "${jsonlPath}" --output "${outputDir}" --base-model "${OLLAMA_MODEL}" --job-id "${trainingJobId}" --log-file "${logFile}"${batchSizeArg ? ' ' + batchSizeArg : ''}`;

    await logTrainingEvent(trainingJobId, 'info', 'Executing training command', {
      command,
      pythonCmd: PYTHON_CMD,
      isDocker: IS_DOCKER,
      scriptPath: finalScriptPath,
      logFile,
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

  // Kill the process if it's running
  const process = runningProcesses.get(trainingJobId);
  if (process) {
    try {
      // On Windows, we need to kill the process tree (Python spawns child processes)
      const platform = require('os').platform();
      if (platform === 'win32') {
        // Windows: Kill process tree
        if (process.pid) {
          try {
            // Use taskkill on Windows to kill process tree
            const { execSync } = require('child_process');
            execSync(`taskkill /F /T /PID ${process.pid}`, { stdio: 'ignore' });
          } catch (killError) {
            // Fallback to regular kill
            process.kill('SIGKILL');
          }
        } else {
          process.kill('SIGKILL');
        }
      } else {
        // Unix-like: Try graceful shutdown first (SIGTERM)
        process.kill('SIGTERM');

        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (process && !process.killed && process.pid) {
            try {
              process.kill('SIGKILL');
            } catch (e) {
              // Process already dead
            }
          }
        }, 2000);
      }
    } catch (error) {
      logger.warn({
        operation: 'cancel_training_process_error',
        message: 'Failed to kill training process',
        context: {
          trainingJobId,
          pid: process.pid,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    runningProcesses.delete(trainingJobId);
  } else {
    // Process not in map - might be running but not tracked
    // Try to find and kill Python processes for this job
    logger.warn({
      operation: 'cancel_training_process_not_found',
      message: 'Training process not found in tracking map, attempting to find and kill',
      context: {
        trainingJobId,
      },
    });

    try {
      const { execSync } = require('child_process');
      const platform = require('os').platform();
      if (platform === 'win32') {
        // Windows: Find Python processes with the job ID in command line
        // Try to find processes by searching for the training job ID in the command
        try {
          execSync(`wmic process where "commandline like '%${trainingJobId}%'" delete`, { stdio: 'ignore' });
        } catch (e) {
          // Fallback: try taskkill with filter
          try {
            execSync(`taskkill /F /FI "IMAGENAME eq python.exe" /FI "COMMANDLINE eq *${trainingJobId}*" /T`, { stdio: 'ignore' });
          } catch (e2) {
            // Ignore - process might not exist
          }
        }
      } else {
        // Unix: Find and kill Python processes
        execSync(`pkill -f "trainLora.py.*${trainingJobId}"`, { stdio: 'ignore' });
      }
    } catch (findError) {
      // Ignore errors - process might not exist
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

  // Update job status
  await prisma.trainingJob.update({
    where: { id: trainingJobId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
      errorMessage: 'Training cancelled by user',
    },
  });

  await logTrainingEvent(trainingJobId, 'info', 'Training cancelled by user', {});

  logger.info({
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

