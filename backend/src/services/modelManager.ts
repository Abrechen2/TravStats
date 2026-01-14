import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { getTrainingConfig, TrainingConfig } from './trainingService';
import { prisma } from '../db';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';

// Cache for model availability checks (5 minute TTL)
interface ModelCacheEntry {
  available: boolean;
  timestamp: number;
}

const modelCache = new Map<string, ModelCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a trained model is available in Ollama
 * Uses caching to reduce API calls
 */
export async function checkTrainedModelAvailable(modelName: string): Promise<boolean> {
  // Check cache first
  const cached = modelCache.get(modelName);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.available;
  }
  
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 5000,
    });
    
    const models = response.data.models || [];
    const available = models.some((m: any) => m.name === modelName);
    
    // Update cache
    modelCache.set(modelName, {
      available,
      timestamp: now,
    });
    
    return available;
  } catch (error) {
    logger.warn({
      operation: 'check_trained_model_available_error',
      message: 'Failed to check model availability',
      context: {
        modelName,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    
    // On error, assume not available
    modelCache.set(modelName, {
      available: false,
      timestamp: now,
    });
    
    return false;
  }
}

/**
 * Clear model availability cache
 */
export function clearModelCache(): void {
  modelCache.clear();
}

/**
 * Archive previous model version before training new one
 * @param modelName - Name of the model to archive
 * @param currentModelPath - Path to current model directory
 */
export async function archivePreviousModel(
  modelName: string,
  currentModelPath: string
): Promise<string | null> {
  try {
    const config = await getTrainingConfig();
    const archiveDir = path.join(config.modelOutputDir, 'archive');
    
    // Ensure archive directory exists
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    // Check if current model path exists
    if (!fs.existsSync(currentModelPath)) {
      logger.debug({
        operation: 'archive_previous_model',
        message: 'Current model path does not exist, nothing to archive',
        context: { currentModelPath },
      });
      return null;
    }
    
    // Create archive path with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const archivePath = path.join(archiveDir, `${modelName}-${timestamp}`);
    
    // Copy model files to archive
    if (fs.existsSync(currentModelPath)) {
      // Create archive directory
      fs.mkdirSync(archivePath, { recursive: true });
      
      // Copy all files from current model to archive
      const files = fs.readdirSync(currentModelPath);
      for (const file of files) {
        const srcPath = path.join(currentModelPath, file);
        const destPath = path.join(archivePath, file);
        
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
        } else if (fs.statSync(srcPath).isDirectory()) {
          // Recursively copy directories
          copyDirectory(srcPath, destPath);
        }
      }
      
      logger.info({
        operation: 'archive_previous_model',
        message: 'Previous model archived successfully',
        context: {
          modelName,
          archivePath,
          currentModelPath,
        },
      });
      
      return archivePath;
    }
    
    return null;
  } catch (error) {
    logger.error({
      operation: 'archive_previous_model_error',
      message: 'Failed to archive previous model',
      context: {
        modelName,
        currentModelPath,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Helper function to recursively copy directory
 */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Validate model integrity
 * @param modelPath - Path to model directory
 * @returns true if model is valid, false otherwise
 */
export function validateModel(modelPath: string): boolean {
  try {
    if (!fs.existsSync(modelPath)) {
      return false;
    }
    
    // Check for required files
    const requiredFiles = ['adapter_config.json', 'adapter_model.bin'];
    for (const file of requiredFiles) {
      const filePath = path.join(modelPath, file);
      if (!fs.existsSync(filePath)) {
        logger.warn({
          operation: 'validate_model',
          message: `Required file missing: ${file}`,
          context: { modelPath, file },
        });
        return false;
      }
      
      // Check file size (should be at least 1MB for adapter_model.bin)
      const stats = fs.statSync(filePath);
      if (file === 'adapter_model.bin' && stats.size < 1024 * 1024) {
        logger.warn({
          operation: 'validate_model',
          message: 'Model file too small, may be corrupted',
          context: { modelPath, file, size: stats.size },
        });
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error({
      operation: 'validate_model_error',
      message: 'Failed to validate model',
      context: {
        modelPath,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return false;
  }
}

/**
 * Get model path for a given model name and type
 */
export async function getModelPath(
  modelName: string,
  modelType: 'email' | 'vision' | 'combined'
): Promise<string> {
  const config = await getTrainingConfig();
  
  // For combined models, use email model path
  const actualModelName = modelType === 'combined' 
    ? config.emailModelName 
    : modelType === 'email'
    ? config.emailModelName
    : config.visionModelName;
  
  return path.join(config.modelOutputDir, actualModelName);
}

/**
 * Select model for parsing based on user settings and availability
 * Priority: User preference → Trained model (if available) → Base model
 * @param type - Type of parsing ('email' | 'vision')
 * @param userId - Optional user ID to check user settings
 * @returns Model name to use
 */
export async function selectModelForParsing(
  type: 'email' | 'vision',
  userId?: string
): Promise<string> {
  const config = await getTrainingConfig();
  
  // Get base models
  const baseModel = type === 'email' ? OLLAMA_MODEL : OLLAMA_VISION_MODEL;
  const trainedModelName = type === 'email' 
    ? config.emailModelName 
    : config.visionModelName;
  
  // If no user ID provided, use auto mode (trained if available, else base)
  if (!userId) {
    const available = await checkTrainedModelAvailable(trainedModelName);
    return available ? trainedModelName : baseModel;
  }
  
  // Get user settings
  try {
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        useTrainedModels: true,
        preferredEmailModel: true,
        preferredVisionModel: true,
      },
    });
    
    // Check if user wants to use trained models
    if (userSettings?.useTrainedModels === false) {
      return baseModel;
    }
    
    // Get preference for this type
    const preference = type === 'email'
      ? (userSettings?.preferredEmailModel || 'auto')
      : (userSettings?.preferredVisionModel || 'auto');
    
    // Explicit base model preference
    if (preference === 'base') {
      return baseModel;
    }
    
    // Explicit trained model preference
    if (preference === 'trained') {
      const available = await checkTrainedModelAvailable(trainedModelName);
      if (!available) {
        logger.warn({
          operation: 'select_model_for_parsing',
          message: `Trained model '${trainedModelName}' not available, but user preference is 'trained'`,
          context: { type, userId, trainedModelName },
        });
        // Fallback to base even if user wants trained (graceful degradation)
        return baseModel;
      }
      return trainedModelName;
    }
    
    // Auto mode: use trained if available, else base
    const available = await checkTrainedModelAvailable(trainedModelName);
    return available ? trainedModelName : baseModel;
  } catch (error) {
    logger.warn({
      operation: 'select_model_for_parsing_error',
      message: 'Failed to get user settings, using auto mode',
      context: {
        type,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    
    // Fallback to auto mode
    const available = await checkTrainedModelAvailable(trainedModelName);
    return available ? trainedModelName : baseModel;
  }
}













