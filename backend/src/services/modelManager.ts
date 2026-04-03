import axios from 'axios';
import logger from '../utils/logger';
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
    const available = models.some((m: { name: string }) => m.name === modelName);

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
  const adminSettings = await prisma.adminSettings.findFirst().catch(() => null);
  const emailModelName = adminSettings?.trainingEmailModelName
    || process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom';
  const visionModelName = adminSettings?.trainingVisionModelName
    || process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom';

  // Get base models
  const baseModel = type === 'email' ? OLLAMA_MODEL : OLLAMA_VISION_MODEL;
  const trainedModelName = type === 'email'
    ? emailModelName
    : visionModelName;

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
