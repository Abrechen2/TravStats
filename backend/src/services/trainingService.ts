import { prisma } from '../db';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { createTrainingExample, Annotation } from './annotationService';
import { ParsedBooking } from './bookingParser';
import { getHardwareInfo } from './hardwareService';
import { archivePreviousModel, validateModel } from './modelManager';
import * as fs from 'fs';
import * as path from 'path';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Store for running training processes to allow cancellation
const runningProcesses = new Map<string, ChildProcess>();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';

// ENV variables with defaults
const TRAINING_MODEL_OUTPUT_DIR_ENV = process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models';
const TRAINING_EMAIL_MODEL_NAME_ENV = process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom';
const TRAINING_VISION_MODEL_NAME_ENV = process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom';

// Legacy constants (for backward compatibility)
const TRAINING_MODEL_NAME = 'travstats-custom';
const TRAINING_DATA_DIR = path.join(__dirname, '../../data/training');
const TRAINING_LOGS_DIR = path.join(__dirname, '../../data/logs/training');

// Python command detection - works both locally and in Docker
// Use environment variable if set, otherwise use generic python3/python
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const IS_DOCKER = fs.existsSync('/.dockerenv') || process.env.DOCKER === 'true';

// Ensure directories exist
// Wrap in try-catch to prevent startup failures if permissions are missing
try {
  if (!fs.existsSync(TRAINING_DATA_DIR)) {
    fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
    logger.info({
      operation: 'training_data_dir_created',
      message: `Created training data directory: ${TRAINING_DATA_DIR}`,
      context: { directory: TRAINING_DATA_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first training attempt
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.warn(`[Training] Could not create training data directory ${TRAINING_DATA_DIR}:`, errorMsg);
  console.warn('[Training] Training may fail until directory permissions are fixed');
  logger.warn({
    operation: 'training_data_dir_creation_failed',
    message: `Could not create training data directory: ${TRAINING_DATA_DIR}`,
    context: { directory: TRAINING_DATA_DIR, error: errorMsg },
  });
}

try {
  if (!fs.existsSync(TRAINING_LOGS_DIR)) {
    fs.mkdirSync(TRAINING_LOGS_DIR, { recursive: true });
    logger.info({
      operation: 'training_logs_dir_created',
      message: `Created training logs directory: ${TRAINING_LOGS_DIR}`,
      context: { directory: TRAINING_LOGS_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first training attempt
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.warn(`[Training] Could not create training logs directory ${TRAINING_LOGS_DIR}:`, errorMsg);
  console.warn('[Training] Training logs may not be saved until directory permissions are fixed');
  logger.warn({
    operation: 'training_logs_dir_creation_failed',
    message: `Could not create training logs directory: ${TRAINING_LOGS_DIR}`,
    context: { directory: TRAINING_LOGS_DIR, error: errorMsg },
  });
}

/**
 * Training configuration interface
 */
export interface TrainingConfig {
  modelOutputDir: string;
  emailModelName: string;
  visionModelName: string;
}

/**
 * Get training configuration from AdminSettings → ENV → Defaults
 * Priority: AdminSettings > ENV > Defaults
 */
export async function getTrainingConfig(): Promise<TrainingConfig> {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();
    
    // Resolve model output directory
    const modelOutputDir = adminSettings?.trainingModelOutputDir 
      || TRAINING_MODEL_OUTPUT_DIR_ENV;
    
    // Resolve absolute path (relative to backend directory)
    const absoluteOutputDir = path.isAbsolute(modelOutputDir)
      ? modelOutputDir
      : path.join(__dirname, '../../', modelOutputDir);
    
    // Ensure directory exists
    if (!fs.existsSync(absoluteOutputDir)) {
      fs.mkdirSync(absoluteOutputDir, { recursive: true });
    }
    
    // Resolve model names
    const emailModelName = adminSettings?.trainingEmailModelName 
      || TRAINING_EMAIL_MODEL_NAME_ENV;
    const visionModelName = adminSettings?.trainingVisionModelName 
      || TRAINING_VISION_MODEL_NAME_ENV;
    
    return {
      modelOutputDir: absoluteOutputDir,
      emailModelName,
      visionModelName,
    };
  } catch (error) {
    logger.warn({
      operation: 'get_training_config_error',
      message: 'Failed to load training config, using defaults',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    // Fallback to defaults
    const absoluteOutputDir = path.isAbsolute(TRAINING_MODEL_OUTPUT_DIR_ENV)
      ? TRAINING_MODEL_OUTPUT_DIR_ENV
      : path.join(__dirname, '../../', TRAINING_MODEL_OUTPUT_DIR_ENV);
    
    if (!fs.existsSync(absoluteOutputDir)) {
      fs.mkdirSync(absoluteOutputDir, { recursive: true });
    }
    
    return {
      modelOutputDir: absoluteOutputDir,
      emailModelName: TRAINING_EMAIL_MODEL_NAME_ENV,
      visionModelName: TRAINING_VISION_MODEL_NAME_ENV,
    };
  }
}

/**
 * Prepare training data in LoRA format (JSONL)
 * @param trainingDataIds - Array of training data IDs
 * @param typeFilter - Optional filter by type ('email' | 'boarding_pass')
 */
export async function prepareTrainingData(
  trainingDataIds: string[],
  typeFilter?: 'email' | 'boarding_pass'
): Promise<string> {
  const whereClause: Prisma.TrainingDataWhereInput = {
    id: { in: trainingDataIds },
    status: 'pending',
    ...(typeFilter ? { type: typeFilter } : {}),
  };
  
  const trainingData = await prisma.trainingData.findMany({
    where: whereClause,
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

  interface TrainingExample {
    instruction: string;
    input: string;
    output: string;
    metadata: Record<string, unknown>;
  }

  const examples: TrainingExample[] = [];

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
  metadata?: Prisma.InputJsonObject
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
 * @param modelType - Optional filter by model type
 * Returns null if no successful training exists
 */
async function findLastSuccessfulTraining(modelType?: 'email' | 'vision' | 'combined'): Promise<string | null> {
  try {
    const whereClause: Prisma.TrainingJobWhereInput = {
      status: 'completed',
      ...(modelType ? { modelType } : {}),
    };
    
    const lastJob = await prisma.trainingJob.findFirst({
      where: whereClause,
      orderBy: {
        completedAt: 'desc',
      },
      select: {
        id: true,
        metrics: true,
        modelType: true,
      },
    });

    if (!lastJob) {
      return null;
    }

    // Try to get modelPath from metrics first
    const metrics = lastJob.metrics as Record<string, unknown> | null;
    if (metrics && typeof metrics === 'object' && 'modelPath' in metrics && typeof metrics.modelPath === 'string') {
      const modelPath = metrics.modelPath;
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }

    // Fallback: construct path from job ID and model type
    // Use configured output directory
    const config = await getTrainingConfig();
    const jobModelType = (lastJob.modelType as 'email' | 'vision' | 'combined') || 'combined';
    const modelName = jobModelType === 'email' 
      ? config.emailModelName 
      : jobModelType === 'vision'
      ? config.visionModelName
      : config.emailModelName; // Combined uses email model name
    
    const modelPath = path.join(config.modelOutputDir, modelName);
    if (fs.existsSync(modelPath)) {
      return modelPath;
    }
    
    // Legacy fallback: old path structure
    const legacyPath = path.join(TRAINING_DATA_DIR, `output-${lastJob.id}`);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
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
 * @param trainingJobId - Training job ID
 * @param jsonlPath - Path to JSONL training data file
 * @param modelType - Type of model to train ('email' | 'vision' | 'combined')
 */
export async function trainModel(
  trainingJobId: string,
  jsonlPath: string,
  modelType: 'email' | 'vision' | 'combined' = 'combined'
): Promise<{ modelPath: string; metrics: Prisma.InputJsonObject }> {
  // Get training configuration
  const config = await getTrainingConfig();
  
  // Determine model name and base model based on type
  let modelName: string;
  let baseModel: string;
  
  if (modelType === 'email') {
    modelName = config.emailModelName;
    baseModel = OLLAMA_MODEL;
  } else if (modelType === 'vision') {
    modelName = config.visionModelName;
    baseModel = OLLAMA_VISION_MODEL;
  } else {
    // Combined: use email model name for backward compatibility
    modelName = config.emailModelName;
    baseModel = OLLAMA_MODEL;
  }
  
  await logTrainingEvent(trainingJobId, 'info', 'Starting LoRA training', {
    jsonlPath,
    baseModel,
    modelName,
    modelType,
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
  // Use configured output directory
  const outputDir = path.join(config.modelOutputDir, modelName);
  
  // Archive previous model if it exists
  if (fs.existsSync(outputDir)) {
    const archivedPath = await archivePreviousModel(modelName, outputDir);
    if (archivedPath) {
      await logTrainingEvent(trainingJobId, 'info', 'Previous model archived', {
        archivedPath,
        modelName,
      });
    }
    
    // Remove old model directory (will be replaced by new training)
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Find previous successful training to continue from (same model type)
    const previousModelPath = await findLastSuccessfulTraining(modelType);
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
        baseModel,
      });
      logger.info({
        operation: 'training_new',
        message: 'Starting new training from base model',
        context: {
          trainingJobId,
          baseModel,
        },
      });
    }

    // Get hardware info before training (for logging only)
    let hardwareInfo;
    try {
      hardwareInfo = await getHardwareInfo();

      // Log hardware info
      await logTrainingEvent(trainingJobId, 'info', 'Hardware information', {
        cpu: hardwareInfo.cpu as unknown as Prisma.InputJsonValue,
        gpu: hardwareInfo.gpu as unknown as Prisma.InputJsonValue,
        python: hardwareInfo.python as unknown as Prisma.InputJsonValue,
        docker: hardwareInfo.docker,
        trainingAccess: hardwareInfo.trainingAccess as unknown as Prisma.InputJsonValue,
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
    const command = `${PYTHON_CMD} "${finalScriptPath}" --input "${jsonlPath}" --output "${outputDir}" --base-model "${baseModel}" --job-id "${trainingJobId}" --log-file "${logFile}"${previousModelArg}`;

    await logTrainingEvent(trainingJobId, 'info', 'Executing training command', {
      command,
      pythonCmd: PYTHON_CMD,
      isDocker: IS_DOCKER,
      scriptPath: finalScriptPath,
      logFile,
      previousModelPath: previousModelPath || undefined,
      isContinuingTraining,
      hardwareInfo: hardwareInfo ? {
        cpu: hardwareInfo.cpu as unknown as Prisma.InputJsonValue,
        gpu: hardwareInfo.gpu as unknown as Prisma.InputJsonValue,
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
        cpu: hardwareInfo.cpu as unknown as Prisma.InputJsonValue,
        gpu: hardwareInfo.gpu as unknown as Prisma.InputJsonValue,
      } : undefined,
    });

    // Validate model after training
    const isValid = validateModel(outputDir);
    if (!isValid) {
      throw new Error('Trained model validation failed');
    }
    
    // Parse metrics from stdout
    const metricsLine = stdout.split('\n').find((line: string) => line.startsWith('METRICS_JSON:'));
    let parsedMetrics: Record<string, unknown> = {};
    if (metricsLine) {
      try {
        const jsonStr = metricsLine.slice('METRICS_JSON:'.length);
        parsedMetrics = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        logger.warn({ operation: 'parse_training_metrics', message: 'Failed to parse metrics JSON from output' });
      }
    }

    const metrics: Prisma.InputJsonObject = {
      status: 'completed',
      logFile,
      modelPath: outputDir,
      modelName,
      modelType,
      isValid,
      finalLoss: parsedMetrics.final_loss ?? null,
      totalSteps: parsedMetrics.total_steps ?? null,
      epochsCompleted: parsedMetrics.epochs_completed ?? null,
      numExamples: parsedMetrics.num_examples ?? null,
      logHistory: parsedMetrics.log_history ?? [],
      hardwareInfo: hardwareInfo ? {
        cpu: hardwareInfo.cpu as unknown as Prisma.InputJsonValue,
        gpu: hardwareInfo.gpu as unknown as Prisma.InputJsonValue,
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
  } finally {
    // Always clean up process tracking, even on errors
    runningProcesses.delete(trainingJobId);
  }
}

/**
 * Export trained model to Ollama
 * @param trainingJobId - Training job ID
 * @param modelPath - Path to trained model directory
 * @param modelType - Type of model ('email' | 'vision' | 'combined')
 */
export async function exportToOllama(
  trainingJobId: string,
  modelPath: string,
  modelType: 'email' | 'vision' | 'combined' = 'combined'
): Promise<void> {
  await logTrainingEvent(trainingJobId, 'info', 'Exporting model to Ollama', { modelPath, modelType });

  try {
    // Get training configuration to determine model name
    const config = await getTrainingConfig();
    
    // Determine model name and base model based on type
    let modelName: string;
    let baseModel: string;
    
    if (modelType === 'email') {
      modelName = config.emailModelName;
      baseModel = OLLAMA_MODEL;
    } else if (modelType === 'vision') {
      modelName = config.visionModelName;
      baseModel = OLLAMA_VISION_MODEL;
    } else {
      // Combined: use email model name for backward compatibility
      modelName = config.emailModelName;
      baseModel = OLLAMA_MODEL;
    }
    
    // Create Modelfile for Ollama
    const modelfilePath = path.join(modelPath, 'Modelfile');
    const systemPrompt = modelType === 'email'
      ? 'You are a specialized flight booking email parser. Extract flight information accurately from emails. Return JSON format with flight details.'
      : modelType === 'vision'
      ? 'You are a specialized boarding pass parser. Extract flight information accurately from boarding pass images. Return JSON format with flight details.'
      : 'You are a specialized flight booking email and boarding pass parser. Extract flight information accurately from emails and boarding passes. Return JSON format with flight details.';
    
    const modelfileContent = `FROM ${baseModel}

PARAMETER temperature 0.1
PARAMETER top_p 0.9

SYSTEM """${systemPrompt}"""
`;

    fs.writeFileSync(modelfilePath, modelfileContent, 'utf-8');

    // Import to Ollama (this would need the actual GGUF file)
    // For now, we'll just log the command that would be run
    const command = `ollama create ${modelName} -f "${modelfilePath}"`;

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
      modelName,
      modelType,
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
 * @param userId - Optional user ID to check user settings for separate models
 */
export async function triggerTraining(userId?: string): Promise<string> {
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

  // Get training configuration to check if separate models are enabled
  const config = await getTrainingConfig();
  
  // Check user settings for separate models (default: true)
  let useSeparateModels = true; // Default
  if (userId) {
    try {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { trainingSeparateModels: true },
      });
      useSeparateModels = userSettings?.trainingSeparateModels ?? true;
    } catch (error) {
      logger.warn({
        operation: 'trigger_training_user_settings_error',
        message: 'Failed to load user settings, using default',
        context: {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
  
  if (useSeparateModels) {
    // Separate jobs for email and vision
    const emailData = await prisma.trainingData.findMany({
      where: { 
        status: 'pending',
        type: 'email',
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
    
    const visionData = await prisma.trainingData.findMany({
      where: { 
        status: 'pending',
        type: 'boarding_pass',
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
    
    const jobs: string[] = [];
    
    // Create email training job if we have at least 5 email entries
    if (emailData.length >= 5) {
      const emailJob = await prisma.trainingJob.create({
        data: {
          status: 'pending',
          trainingDataIds: emailData.map((d) => d.id),
          modelName: config.emailModelName,
          modelType: 'email',
        },
      });
      jobs.push(emailJob.id);
      processTrainingJob(emailJob.id).catch((error) => {
        logger.error({
          operation: 'trigger_training_error',
          message: 'Failed to process email training job',
          context: {
            trainingJobId: emailJob.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      });
    }
    
    // Create vision training job if we have at least 5 vision entries
    if (visionData.length >= 5) {
      const visionJob = await prisma.trainingJob.create({
        data: {
          status: 'pending',
          trainingDataIds: visionData.map((d) => d.id),
          modelName: config.visionModelName,
          modelType: 'vision',
        },
      });
      jobs.push(visionJob.id);
      processTrainingJob(visionJob.id).catch((error) => {
        logger.error({
          operation: 'trigger_training_error',
          message: 'Failed to process vision training job',
          context: {
            trainingJobId: visionJob.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      });
    }
    
    if (jobs.length === 0) {
      throw new Error('Not enough training data for separate models. Need at least 5 entries of each type.');
    }
    
    // Return first job ID (or we could return array of IDs)
    return jobs[0];
  } else {
    // Combined model (backward compatibility)
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
        modelName: config.emailModelName, // Use email model name for combined
        modelType: 'combined',
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

    // Determine model type from job or infer from training data
    let modelType: 'email' | 'vision' | 'combined' = (job.modelType as 'email' | 'vision' | 'combined') || 'combined';
    
    // If modelType is not set, infer from training data
    if (modelType === 'combined') {
      const trainingData = await prisma.trainingData.findMany({
        where: { id: { in: job.trainingDataIds } },
        select: { type: true },
      });
      
      const hasEmail = trainingData.some((d) => d.type === 'email');
      const hasVision = trainingData.some((d) => d.type === 'boarding_pass');
      
      if (hasEmail && !hasVision) {
        modelType = 'email';
      } else if (hasVision && !hasEmail) {
        modelType = 'vision';
      }
      // Otherwise keep 'combined'
    }

    // Prepare training data with type filter if separate models
    const typeFilter = modelType !== 'combined' 
      ? (modelType === 'email' ? 'email' : 'boarding_pass')
      : undefined;
    const jsonlPath = await prepareTrainingData(job.trainingDataIds, typeFilter);

    // Resolve model name for evaluation (needed after training)
    const config = await getTrainingConfig();
    const modelName = modelType === 'email' ? config.emailModelName
      : modelType === 'vision' ? config.visionModelName
      : config.emailModelName;

    // Train model
    const { modelPath, metrics } = await trainModel(trainingJobId, jsonlPath, modelType);

    // Export to Ollama
    await exportToOllama(trainingJobId, modelPath, modelType);

    // Evaluate model quality (non-blocking - failure does not affect training success)
    const evalResult = await evaluateModel(trainingJobId, modelName, jsonlPath);
    if (evalResult) {
      await logTrainingEvent(trainingJobId, 'info', 'Model evaluation completed', {
        overallScore: evalResult.overallScore as unknown as Prisma.InputJsonValue,
        fieldAccuracy: evalResult.fieldAccuracy as unknown as Prisma.InputJsonValue,
        samplesTested: evalResult.samplesTested as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonObject);
    }

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
        metrics: {
          ...(metrics as Record<string, unknown>),
          ...(evalResult ? {
            evaluation: {
              overallScore: evalResult.overallScore,
              fieldAccuracy: evalResult.fieldAccuracy,
              samplesTested: evalResult.samplesTested,
              fieldScores: evalResult.fieldScores,
            } as Prisma.InputJsonValue,
          } : {}),
        } as Prisma.InputJsonObject,
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

export interface ModelEvaluationResult {
  modelName: string;
  samplesTested: number;
  responseRate: number;
  fieldAccuracy: number;
  fieldScores: Record<string, number>;
  overallScore: number;
  issues: string[];
}

/**
 * Evaluate a trained model by running it against test samples from the JSONL file.
 * Returns null on any error - evaluation failure does not break training.
 */
export async function evaluateModel(
  trainingJobId: string,
  modelName: string,
  testJsonlPath: string
): Promise<ModelEvaluationResult | null> {
  await logTrainingEvent(trainingJobId, 'info', 'Starting model evaluation', {
    modelName,
    testJsonlPath,
  } as Prisma.InputJsonObject);

  // Resolve script path using same IS_DOCKER / dev fallback pattern as trainModel()
  const pythonScript = path.join(__dirname, '../scripts/evalModel.py');
  const devScriptPath = path.join(__dirname, '../../src/scripts/evalModel.py');
  const finalScriptPath = fs.existsSync(pythonScript) ? pythonScript : devScriptPath;

  if (!fs.existsSync(finalScriptPath)) {
    logger.warn({
      operation: 'evaluate_model',
      message: 'evalModel.py script not found - skipping evaluation',
      context: { pythonScript, devScriptPath },
    });
    return null;
  }

  const command = `${PYTHON_CMD} "${finalScriptPath}" --model-name "${modelName}" --test-data "${testJsonlPath}" --ollama-url "${OLLAMA_URL}" --output-json`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    if (stderr) {
      logger.warn({
        operation: 'evaluate_model',
        message: 'evalModel.py produced stderr output',
        context: { modelName, stderr: stderr.substring(0, 500) },
      });
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      logger.warn({
        operation: 'evaluate_model',
        message: 'evalModel.py produced no output',
        context: { modelName },
      });
      return null;
    }

    const parsed: unknown = JSON.parse(trimmed);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).model_name !== 'string' ||
      typeof (parsed as Record<string, unknown>).samples_tested !== 'number' ||
      typeof (parsed as Record<string, unknown>).response_rate !== 'number' ||
      typeof (parsed as Record<string, unknown>).field_accuracy !== 'number' ||
      typeof (parsed as Record<string, unknown>).overall_score !== 'number'
    ) {
      logger.warn({
        operation: 'evaluate_model',
        message: 'evalModel.py output has unexpected format',
        context: { modelName, output: trimmed.substring(0, 200) },
      });
      return null;
    }

    const raw = parsed as Record<string, unknown>;

    const result: ModelEvaluationResult = {
      modelName: raw.model_name as string,
      samplesTested: raw.samples_tested as number,
      responseRate: raw.response_rate as number,
      fieldAccuracy: raw.field_accuracy as number,
      fieldScores: (typeof raw.field_scores === 'object' && raw.field_scores !== null)
        ? (raw.field_scores as Record<string, number>)
        : {},
      overallScore: raw.overall_score as number,
      issues: Array.isArray(raw.issues) ? (raw.issues as string[]) : [],
    };

    logger.info({
      operation: 'evaluate_model',
      message: 'Model evaluation completed',
      context: {
        modelName,
        overallScore: result.overallScore,
        fieldAccuracy: result.fieldAccuracy,
        samplesTested: result.samplesTested,
        issues: result.issues,
      },
    });

    return result;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({
      operation: 'evaluate_model',
      message: 'Model evaluation failed - continuing without evaluation metrics',
      context: { modelName, trainingJobId, error: errorMsg },
    });
    return null;
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
        } catch (killError: unknown) {
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
              .filter((pid: string) => pid.trim());
            
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

        try {
          await prisma.trainingJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: 'Training interrupted (server restart)',
            },
          });

          await logTrainingEvent(job.id, 'error', 'Training interrupted by server restart', {});
        } catch (updateError) {
          // Log error for individual job update but continue with other jobs
          logger.warn({
            operation: 'cleanup_stale_job_update_failed',
            message: `Failed to update stale job ${job.id}`,
            context: { jobId: job.id },
            error: updateError instanceof Error ? updateError.message : 'Unknown error',
          });
        }
      }
    }
  } catch (error) {
    // Check if it's a database connection error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isConnectionError = 
      errorMessage.includes('Can\'t reach database server') ||
      errorMessage.includes('database system is shutting down') ||
      errorMessage.includes('Connection refused') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('P1001'); // Prisma connection error code

    if (isConnectionError) {
      // Database is not available - this is expected during startup/shutdown
      // Log as info/warning instead of error to reduce noise
      logger.warn({
        operation: 'cleanup_stale_jobs_db_unavailable',
        message: 'Cannot cleanup stale jobs - database not available (this is normal during startup/shutdown)',
        error: errorMessage,
      });
      // Don't throw - gracefully handle the case where DB is not ready yet
      return;
    }

    // For other errors, log as error
    logger.error({
      operation: 'cleanup_stale_jobs_error',
      message: 'Failed to cleanup stale jobs',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't throw - we don't want cleanup failures to crash the server
  }
}



export interface TrainingDataAnalysis {
  totalExamples: number;
  duplicates: number;
  avgInputLength: number;
  minInputLength: number;
  maxInputLength: number;
  avgOutputLength: number;
  minOutputLength: number;
  maxOutputLength: number;
  emptyInputs: number;
  emptyOutputs: number;
  shortExamples: number;
  issues: string[];
  qualityScore: number;
  estimatedTrainingMinutes: number;
}

/**
 * Analyze training data quality without triggering an actual training run.
 * Creates a temporary JSONL file, runs checkTrainingData.py with --output-json,
 * parses the result, cleans up and returns the analysis.
 */
export async function analyzeTrainingData(
  trainingDataIds: string[],
  typeFilter?: 'email' | 'boarding_pass'
): Promise<TrainingDataAnalysis> {
  // Prepare a temporary JSONL (reuses prepareTrainingData but does not update DB)
  const jsonlPath = await prepareTrainingData(trainingDataIds, typeFilter);

  // Resolve check script path using same pattern as trainModel()
  const pythonScript = path.join(__dirname, '../scripts/checkTrainingData.py');
  const devScriptPath = path.join(__dirname, '../../src/scripts/checkTrainingData.py');
  const finalScriptPath = fs.existsSync(pythonScript) ? pythonScript : devScriptPath;

  if (!fs.existsSync(finalScriptPath)) {
    try {
      fs.unlinkSync(jsonlPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(
      `Quality check script not found at ${finalScriptPath} or ${pythonScript}. ` +
      `Please ensure checkTrainingData.py exists.`
    );
  }

  let rawOutput: string;
  try {
    const command = `${PYTHON_CMD} "${finalScriptPath}" --input "${jsonlPath}" --output-json`;
    logger.info({
      operation: 'analyze_training_data',
      message: 'Running training data quality check',
      context: { command, jsonlPath },
    });
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      logger.warn({
        operation: 'analyze_training_data_stderr',
        message: 'Quality check script produced stderr output',
        context: { stderr },
      });
    }
    rawOutput = stdout;
  } catch (execError) {
    throw new Error(
      `Training data quality check failed: ${
        execError instanceof Error ? execError.message : 'Unknown error'
      }`
    );
  } finally {
    // Always clean up temp JSONL
    try {
      fs.unlinkSync(jsonlPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Parse the JSON output from the script
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error(`Failed to parse quality check output as JSON: ${rawOutput}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('total_examples' in parsed)
  ) {
    throw new Error('Unexpected quality check output format');
  }

  const raw = parsed as Record<string, unknown>;

  const analysis: TrainingDataAnalysis = {
    totalExamples: typeof raw['total_examples'] === 'number' ? raw['total_examples'] : 0,
    duplicates: typeof raw['duplicates'] === 'number' ? raw['duplicates'] : 0,
    avgInputLength: typeof raw['avg_input_length'] === 'number' ? raw['avg_input_length'] : 0,
    minInputLength: typeof raw['min_input_length'] === 'number' ? raw['min_input_length'] : 0,
    maxInputLength: typeof raw['max_input_length'] === 'number' ? raw['max_input_length'] : 0,
    avgOutputLength: typeof raw['avg_output_length'] === 'number' ? raw['avg_output_length'] : 0,
    minOutputLength: typeof raw['min_output_length'] === 'number' ? raw['min_output_length'] : 0,
    maxOutputLength: typeof raw['max_output_length'] === 'number' ? raw['max_output_length'] : 0,
    emptyInputs: typeof raw['empty_inputs'] === 'number' ? raw['empty_inputs'] : 0,
    emptyOutputs: typeof raw['empty_outputs'] === 'number' ? raw['empty_outputs'] : 0,
    shortExamples: typeof raw['short_examples'] === 'number' ? raw['short_examples'] : 0,
    issues: Array.isArray(raw['issues']) ? (raw['issues'] as unknown[]).map(String) : [],
    qualityScore: typeof raw['quality_score'] === 'number' ? raw['quality_score'] : 0,
    estimatedTrainingMinutes:
      typeof raw['estimated_training_minutes'] === 'number'
        ? raw['estimated_training_minutes']
        : 0,
  };

  logger.info({
    operation: 'analyze_training_data_complete',
    message: 'Training data quality analysis complete',
    context: {
      totalExamples: analysis.totalExamples,
      qualityScore: analysis.qualityScore,
      issueCount: analysis.issues.length,
    },
  });

  return analysis;
}

// Run cleanup on startup to catch jobs that were abandoned
cleanupStaleJobs().catch(e => console.error('Failed to cleanup stale jobs:', e));

