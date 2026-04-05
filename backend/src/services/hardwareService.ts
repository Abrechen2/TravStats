import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger';

const execAsync = promisify(exec);

// Python command detection - works both locally and in Docker
// Use environment variable if set, otherwise use generic python3/python
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const IS_DOCKER = fs.existsSync('/.dockerenv') || process.env.DOCKER === 'true';

interface CPUInfo {
  cores: number;
  model: string;
  architecture: string;
  error?: string;
}

interface GPUInfo {
  available: boolean;
  count?: number;
  name?: string;
  memory?: number;
  cudaVersion?: string;
  deviceId?: number;
  error?: string;
  reason?: string;
  diagnosis?: string[];
  pytorchHasCuda?: boolean;
  gpuDetected?: boolean;
  gpuNameDetected?: string;
  gpus?: Array<{
    id: number;
    name: string;
    memory: number;
  }>;
}

interface PythonInfo {
  available: boolean;
  version?: string;
  pytorch?: {
    available: boolean;
    version?: string;
  };
  error?: string;
}

interface PlatformInfo {
  system: string;
  release: string;
  version: string;
}

interface HardwareInfo {
  cpu: CPUInfo;
  gpu: GPUInfo;
  python: PythonInfo;
  docker: boolean;
  platform?: PlatformInfo;
  trainingAccess: {
    accessible: boolean;
    error?: string;
  };
}

/**
 * Get CPU information from Node.js os module
 */
function getCPUInfo(): CPUInfo {
  try {
    const cpus = os.cpus();
    const cores = cpus.length;
    const model = cpus.length > 0 ? cpus[0].model : 'Unknown';
    const architecture = os.arch();

    return {
      cores,
      model,
      architecture,
    };
  } catch (error) {
    logger.error({
      operation: 'get_cpu_info_error',
      message: 'Failed to get CPU info',
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      cores: 1,
      model: 'Unknown',
      architecture: os.arch(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check Python and PyTorch availability via Python script
 */
async function checkPythonAvailability(): Promise<PythonInfo> {
  try {
    // First check if Python is available
    try {
      const { stdout: pythonVersion } = await execAsync(`${PYTHON_CMD} --version`);
      const versionMatch = pythonVersion.match(/Python (\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : 'Unknown';

      // Try to get PyTorch info from checkHardware.py script (more reliable)
      let pytorchAvailable = false;
      let pytorchVersion: string | undefined;

      try {
        const scriptPath = path.join(__dirname, '../scripts/checkHardware.py');
        const devScriptPath = path.join(__dirname, '../../src/scripts/checkHardware.py');
        const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : devScriptPath;

        if (fs.existsSync(finalScriptPath)) {
          const { stdout } = await execAsync(`${PYTHON_CMD} "${finalScriptPath}"`, {
            timeout: 30000, // 30 second timeout (PyTorch import can be slow)
          });
          const hardwareInfo = JSON.parse(stdout);
          if (hardwareInfo.python && hardwareInfo.python.pytorch) {
            pytorchAvailable = hardwareInfo.python.pytorch.available || false;
            pytorchVersion = hardwareInfo.python.pytorch.version;
          }
        }
      } catch (_scriptError) {
        // Fallback: Try direct PyTorch import check
        try {
          const checkScript = `import sys; import torch; print(f"PyTorch {torch.__version__}")`;
          const { stdout: pytorchOutput } = await execAsync(
            `${PYTHON_CMD} -c "${checkScript}"`
          );
          const pytorchMatch = pytorchOutput.match(/PyTorch ([\d.+\w]+)/);
          if (pytorchMatch) {
            pytorchAvailable = true;
            pytorchVersion = pytorchMatch[1];
          }
        } catch {
          // PyTorch not available, that's okay
        }
      }

      return {
        available: true,
        version,
        pytorch: {
          available: pytorchAvailable,
          version: pytorchVersion,
        },
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Python not found',
      };
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check GPU support via Python hardware check script
 */
async function checkGPUSupport(): Promise<GPUInfo> {
  try {
    // Find the hardware check script
    const scriptPath = path.join(__dirname, '../scripts/checkHardware.py');
    const devScriptPath = path.join(__dirname, '../../src/scripts/checkHardware.py');
    const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : devScriptPath;

    if (!fs.existsSync(finalScriptPath)) {
      return {
        available: false,
        error: 'Hardware check script not found',
      };
    }

    const { stdout } = await execAsync(`${PYTHON_CMD} "${finalScriptPath}"`, {
      timeout: 30000, // 30 second timeout (PyTorch import can be slow)
    });

    const hardwareInfo = JSON.parse(stdout);
    return hardwareInfo.gpu || { available: false, error: 'GPU info not available' };
  } catch (error) {
    logger.warn({
      operation: 'check_gpu_support_error',
      message: 'Failed to check GPU support',
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      available: false,
      error: error instanceof Error ? error.message : 'Failed to check GPU',
    };
  }
}

/**
 * Check if training script is accessible and executable
 */
async function checkTrainingAccess(): Promise<{ accessible: boolean; error?: string }> {
  try {
    // Find the training script
    const scriptPath = path.join(__dirname, '../scripts/trainLora.py');
    const devScriptPath = path.join(__dirname, '../../src/scripts/trainLora.py');
    const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : devScriptPath;

    if (!fs.existsSync(finalScriptPath)) {
      return {
        accessible: false,
        error: 'Training script not found',
      };
    }

    // Check if Python can import required modules
    const checkScript = `import sys; import torch; import transformers; import peft; import datasets; sys.exit(0)`;

    try {
      await execAsync(`${PYTHON_CMD} -c "${checkScript}"`, {
        timeout: 20000, // 20 second timeout (PyTorch import can be slow)
      });

      return {
        accessible: true,
      };
    } catch (error) {
      return {
        accessible: false,
        error: error instanceof Error ? error.message : 'Training dependencies not available',
      };
    }
  } catch (error) {
    return {
      accessible: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get complete hardware information
 */
export async function getHardwareInfo(): Promise<HardwareInfo> {
  try {
    // Get CPU info (synchronous, fast)
    const cpu = getCPUInfo();

    // Run Python script once to get all info (more efficient than multiple calls)
    let python: PythonInfo = { available: false, error: 'Not checked yet' };
    let gpu: GPUInfo = { available: false, error: 'Not checked yet' };
    let platformInfo: PlatformInfo | undefined;

    try {
      const scriptPath = path.join(__dirname, '../scripts/checkHardware.py');
      const devScriptPath = path.join(__dirname, '../../src/scripts/checkHardware.py');
      const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : devScriptPath;

      if (fs.existsSync(finalScriptPath)) {
        const { stdout } = await execAsync(`${PYTHON_CMD} "${finalScriptPath}"`, {
          timeout: 30000, // 30 second timeout (PyTorch import can be slow on first run)
        });
        const hardwareInfo = JSON.parse(stdout);

        // Extract info from single script execution
        python = hardwareInfo.python || { available: false, error: 'Not available' };
        gpu = hardwareInfo.gpu || { available: false, error: 'Not available' };
        platformInfo = hardwareInfo.platform;
      } else {
        // Fallback: check Python availability separately
        python = await checkPythonAvailability();
        gpu = await checkGPUSupport();
      }
    } catch (error) {
      logger.warn({
        operation: 'hardware_check_script_error',
        message: 'Hardware check script failed, using fallback methods',
        context: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      // Fallback: check separately
      python = await checkPythonAvailability();
      gpu = await checkGPUSupport();
    }

    // Check training access (separate, can be slow)
    const trainingAccess = await checkTrainingAccess();

    return {
      cpu,
      gpu,
      python,
      docker: IS_DOCKER,
      platform: platformInfo,
      trainingAccess,
    };
  } catch (error) {
    logger.error({
      operation: 'get_hardware_info_error',
      message: 'Failed to get hardware info',
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    // Return minimal info on error
    return {
      cpu: getCPUInfo(),
      gpu: { available: false, error: 'Failed to check GPU' },
      python: { available: false, error: 'Failed to check Python' },
      docker: IS_DOCKER,
      trainingAccess: { accessible: false, error: 'Failed to check training access' },
    };
  }
}
