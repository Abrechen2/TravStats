#!/usr/bin/env python3
"""
Hardware Check Script for TravStats
Checks CPU, GPU, and Python/PyTorch availability
Returns JSON output for TypeScript processing
"""

import json
import sys
import os
import multiprocessing
import platform

# Try to import PyTorch for GPU detection
try:
    import torch
    PYTORCH_AVAILABLE = True
except ImportError:
    PYTORCH_AVAILABLE = False
    torch = None

def get_cpu_info():
    """Get CPU information"""
    try:
        cpu_count = multiprocessing.cpu_count()
        cpu_model = platform.processor()
        architecture = platform.machine()
        
        # Try to get more detailed CPU info on different platforms
        if platform.system() == 'Windows':
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                cpu_model = winreg.QueryValueEx(key, "ProcessorNameString")[0]
                winreg.CloseKey(key)
            except:
                pass
        elif platform.system() == 'Linux':
            try:
                with open('/proc/cpuinfo', 'r') as f:
                    for line in f:
                        if 'model name' in line.lower():
                            cpu_model = line.split(':')[1].strip()
                            break
            except:
                pass
        
        return {
            "cores": cpu_count,
            "model": cpu_model or "Unknown",
            "architecture": architecture
        }
    except Exception as e:
        return {
            "cores": 1,
            "model": "Unknown",
            "architecture": platform.machine() if hasattr(platform, 'machine') else "Unknown",
            "error": str(e)
        }

def get_gpu_info():
    """Get GPU information via PyTorch"""
    if not PYTORCH_AVAILABLE:
        return {
            "available": False,
            "error": "PyTorch not available",
            "diagnosis": ["PyTorch is not installed. Install with: pip install torch"]
        }
    
    try:
        # Check if PyTorch was built with CUDA support
        pytorch_has_cuda = hasattr(torch.version, 'cuda') and torch.version.cuda is not None
        
        cuda_available = torch.cuda.is_available()
        
        if not cuda_available:
            # Provide detailed diagnosis
            diagnosis = []
            if not pytorch_has_cuda:
                diagnosis.append("PyTorch was installed without CUDA support (CPU-only version)")
                diagnosis.append("Install PyTorch with CUDA: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121")
            else:
                diagnosis.append("PyTorch has CUDA support but CUDA is not available")
                diagnosis.append("Check: 1) NVIDIA drivers installed, 2) CUDA toolkit installed, 3) GPU is accessible")
            
            # Try to detect GPU via nvidia-smi (if available)
            gpu_detected = False
            gpu_name_detected = None
            try:
                import subprocess
                result = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0 and result.stdout.strip():
                    gpu_detected = True
                    gpu_name_detected = result.stdout.strip().split('\n')[0]
            except:
                pass
            
            result = {
                "available": False,
                "reason": "CUDA not available",
                "diagnosis": diagnosis,
                "pytorchHasCuda": pytorch_has_cuda
            }
            
            if gpu_detected:
                result["gpuDetected"] = True
                result["gpuNameDetected"] = gpu_name_detected
                result["diagnosis"].append(f"GPU detected via nvidia-smi: {gpu_name_detected}")
                result["diagnosis"].append("GPU is present but PyTorch cannot access it - install PyTorch with CUDA support")
            
            return result
        
        # Get GPU details
        gpu_count = torch.cuda.device_count()
        if gpu_count == 0:
            return {
                "available": False,
                "reason": "No GPU devices found",
                "pytorchHasCuda": pytorch_has_cuda
            }
        
        # Get first GPU info
        gpu_name = torch.cuda.get_device_name(0)
        gpu_props = torch.cuda.get_device_properties(0)
        gpu_memory = gpu_props.total_memory / (1024**3)  # Convert to GB
        
        # Get all GPUs
        gpus = []
        for i in range(gpu_count):
            gpu_name_i = torch.cuda.get_device_name(i)
            gpu_props_i = torch.cuda.get_device_properties(i)
            gpu_memory_i = gpu_props_i.total_memory / (1024**3)
            gpus.append({
                "id": i,
                "name": gpu_name_i,
                "memory": round(gpu_memory_i, 2)
            })
        
        # Try to get CUDA version
        cuda_version = None
        try:
            cuda_version = torch.version.cuda
        except:
            pass
        
        return {
            "available": True,
            "count": gpu_count,
            "name": gpu_name,
            "memory": round(gpu_memory, 2),
            "cudaVersion": cuda_version,
            "deviceId": 0,
            "gpus": gpus,
            "pytorchHasCuda": pytorch_has_cuda
        }
    except Exception as e:
        return {
            "available": False,
            "error": str(e),
            "diagnosis": [f"Error checking GPU: {str(e)}"]
        }

def get_python_info():
    """Get Python and PyTorch version information"""
    python_version = sys.version.split()[0]
    
    pytorch_info = {
        "available": PYTORCH_AVAILABLE,
        "version": None
    }
    
    if PYTORCH_AVAILABLE:
        try:
            pytorch_info["version"] = torch.__version__
        except:
            pass
    
    return {
        "available": True,
        "version": python_version,
        "pytorch": pytorch_info
    }

def main():
    """Main function - returns JSON with hardware info"""
    try:
        # Check if running in Docker
        is_docker = os.path.exists('/.dockerenv') or os.environ.get('DOCKER') == 'true'
        
        hardware_info = {
            "cpu": get_cpu_info(),
            "gpu": get_gpu_info(),
            "python": get_python_info(),
            "docker": is_docker,
            "platform": {
                "system": platform.system(),
                "release": platform.release(),
                "version": platform.version()
            }
        }
        
        # Output as JSON
        print(json.dumps(hardware_info, indent=2))
        sys.exit(0)
    except Exception as e:
        error_info = {
            "error": str(e),
            "cpu": {"cores": 1, "model": "Unknown", "architecture": "Unknown"},
            "gpu": {"available": False, "error": str(e)},
            "python": {"available": False, "error": str(e)},
            "docker": False
        }
        print(json.dumps(error_info, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()

