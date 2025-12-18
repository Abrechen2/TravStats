#!/usr/bin/env python3
"""
Quick GPU test script to verify CUDA 12.8 and RTX 5090 support
"""

import sys

try:
    import torch
    print("=" * 60)
    print("PyTorch GPU Test")
    print("=" * 60)
    print(f"PyTorch version: {torch.__version__}")
    
    # Check CUDA availability
    cuda_available = torch.cuda.is_available()
    print(f"CUDA available: {cuda_available}")
    
    if cuda_available:
        print(f"CUDA version: {torch.version.cuda}")
        print(f"GPU count: {torch.cuda.device_count()}")
        
        for i in range(torch.cuda.device_count()):
            gpu_name = torch.cuda.get_device_name(i)
            gpu_props = torch.cuda.get_device_properties(i)
            gpu_memory = gpu_props.total_memory / (1024**3)
            compute_capability = f"{gpu_props.major}.{gpu_props.minor}"
            
            print(f"\nGPU {i}:")
            print(f"  Name: {gpu_name}")
            print(f"  Memory: {gpu_memory:.2f} GB")
            print(f"  Compute Capability: {compute_capability}")
        
        # Test actual CUDA operation
        print("\n" + "=" * 60)
        print("Testing CUDA operations...")
        try:
            test_tensor = torch.tensor([1.0]).cuda()
            result = test_tensor * 2
            print(f"✅ CUDA test successful! Result: {result.item()}")
            print("✅ GPU is ready for training!")
            del test_tensor
            torch.cuda.empty_cache()
            sys.exit(0)
        except RuntimeError as e:
            print(f"❌ CUDA test failed: {e}")
            print("❌ GPU is not usable for training")
            sys.exit(1)
    else:
        print("❌ CUDA is not available")
        print("Check: 1) NVIDIA drivers, 2) CUDA toolkit, 3) PyTorch CUDA build")
        sys.exit(1)
        
except ImportError:
    print("❌ PyTorch is not installed")
    print("Install with: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128")
    sys.exit(1)
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)










