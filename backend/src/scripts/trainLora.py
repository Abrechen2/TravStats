#!/usr/bin/env python3
"""
LoRA Training Script for TravStats
Trains a LoRA adapter on flight booking emails and boarding passes
"""

import argparse
import json
import os
import sys
import logging
import multiprocessing
from pathlib import Path
from typing import Dict, List, Any, Tuple

# Setup logging - will be configured after parsing args to write to log file
logger = logging.getLogger(__name__)

try:
    from transformers import (
        AutoTokenizer,
        AutoModelForCausalLM,
        TrainingArguments,
        Trainer,
        DataCollatorForLanguageModeling
    )
    from peft import (
        LoraConfig,
        get_peft_model,
        prepare_model_for_kbit_training,
        TaskType
    )
    from datasets import Dataset
    import torch
except ImportError as e:
    logger.error(f"Required packages not installed: {e}")
    logger.error("Please install: pip install transformers peft datasets torch")
    sys.exit(1)


def load_training_data(jsonl_path: str) -> List[Dict[str, Any]]:
    """Load training data from JSONL file"""
    examples = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    logger.info(f"Loaded {len(examples)} training examples")
    return examples


def format_prompt(example: Dict[str, Any]) -> str:
    """Format training example as prompt with annotations"""
    instruction = example.get('instruction', '')
    input_text = example.get('input', '')
    output = example.get('output', '')
    metadata = example.get('metadata', {})
    annotation_type = metadata.get('type', 'email')
    
    # Build annotation context section
    annotation_section = ""
    
    if annotation_type == 'email':
        # Extract highlights from metadata
        highlights = metadata.get('highlights', [])
        highlights_grouped = metadata.get('highlightsGrouped', {})
        highlights_ungrouped = metadata.get('highlightsUngrouped', [])
        
        if highlights or highlights_grouped or highlights_ungrouped:
            annotation_section = "\n\nMarkierte Textstellen (als Referenz):\n"
            
            # Process grouped highlights (by flight)
            if highlights_grouped:
                for flight_index in sorted(highlights_grouped.keys()):
                    flight_highlights = highlights_grouped[flight_index]
                    if flight_highlights:
                        annotation_section += f"\nFlug {flight_index + 1}:\n"
                        for highlight in flight_highlights:
                            label = highlight.get('label', '')
                            text = highlight.get('text', '')
                            context = highlight.get('context', '')
                            # Truncate context if too long
                            if len(context) > 200:
                                context = context[:100] + "..." + context[-100:]
                            annotation_section += f"- {label}: \"{text}\"\n"
                            annotation_section += f"  Kontext: \"{context}\"\n"
            
            # Process ungrouped highlights
            if highlights_ungrouped:
                if not highlights_grouped:
                    annotation_section += "\n"
                for highlight in highlights_ungrouped:
                    label = highlight.get('label', '')
                    text = highlight.get('text', '')
                    context = highlight.get('context', '')
                    # Truncate context if too long
                    if len(context) > 200:
                        context = context[:100] + "..." + context[-100:]
                    annotation_section += f"- {label}: \"{text}\"\n"
                    annotation_section += f"  Kontext: \"{context}\"\n"
            
            # Fallback: use simple highlights if grouped/ungrouped not available
            if not highlights_grouped and not highlights_ungrouped and highlights:
                for highlight in highlights:
                    label = highlight.get('label', '')
                    text = highlight.get('text', '')
                    context = highlight.get('context', '')
                    if context:
                        if len(context) > 200:
                            context = context[:100] + "..." + context[-100:]
                        annotation_section += f"- {label}: \"{text}\"\n"
                        annotation_section += f"  Kontext: \"{context}\"\n"
                    else:
                        annotation_section += f"- {label}: \"{text}\"\n"
    
    elif annotation_type == 'boarding_pass':
        # Extract bounding boxes from metadata
        bounding_boxes = metadata.get('boundingBoxes', [])
        
        if bounding_boxes:
            annotation_section = "\n\nMarkierte Bereiche:\n"
            for box in bounding_boxes:
                label = box.get('label', '')
                x = box.get('x', 0)
                y = box.get('y', 0)
                width = box.get('width', 0)
                height = box.get('height', 0)
                annotation_section += f"- {label}: (Position: x={x}, y={y}, w={width}, h={height})\n"
    
    # Format as instruction-following prompt with annotations
    if annotation_type == 'email':
        prompt = f"{instruction}{annotation_section}\n\nEmail Text:\n{input_text}\n\nResponse:\n{output}"
    else:
        prompt = f"{instruction}{annotation_section}\n\n{input_text}\n\nResponse:\n{output}"
    
    return prompt


def prepare_dataset(examples: List[Dict[str, Any]], tokenizer, max_length: int = 2048) -> Dataset:
    """Prepare dataset for training"""
    def tokenize_function(examples_batch):
        # When batched=True, examples_batch is a dict-like object (dict or LazyBatch)
        # with column names as keys. Each value is a list of values for that column.
        # Convert to list of dictionaries
        
        # Check if it's dict-like (has keys() method)
        if not hasattr(examples_batch, 'keys'):
            raise ValueError(f"Expected dict-like object, got {type(examples_batch)}")
        
        # Extract all keys (column names)
        keys = list(examples_batch.keys())
        if not keys:
            return {}
        
        # Get the number of examples in the batch
        # The first value should be a list (or sequence) when batched=True
        first_key = keys[0]
        first_value = examples_batch[first_key]
        
        # When batched=True, values are always lists/sequences
        # Get length of first value to determine batch size
        try:
            num_examples = len(first_value)
        except (TypeError, AttributeError):
            # Not a sequence, treat as single example (shouldn't happen with batched=True)
            num_examples = 1
            examples_list = [{key: examples_batch[key] for key in keys}]
        else:
            # Batched format: each key maps to a list of values
            # Convert to list of dictionaries
            examples_list = [
                {key: examples_batch[key][i] for key in keys}
                for i in range(num_examples)
            ]
        
        # Format each example as a prompt
        texts = [format_prompt(ex) for ex in examples_list]
        return tokenizer(
            texts,
            truncation=True,
            padding='max_length',
            max_length=max_length,
            return_tensors='pt'
        )
    
    dataset = Dataset.from_list(examples)
    tokenized = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=dataset.column_names
    )
    
    return tokenized


def test_cuda_compatibility() -> Tuple[bool, str]:
    """Test if CUDA is actually usable (not just available)
    
    Returns:
        tuple: (is_usable, error_message)
    """
    if not torch.cuda.is_available():
        return False, "CUDA is not available"
    
    try:
        # Try a simple CUDA operation to test compatibility
        test_tensor = torch.tensor([1.0]).cuda()
        _ = test_tensor * 2
        del test_tensor
        torch.cuda.empty_cache()
        return True, ""
    except RuntimeError as e:
        error_msg = str(e).lower()
        if "no kernel image" in error_msg or "not compatible" in error_msg:
            # Try to detect GPU model for better error message
            gpu_name = "Unknown GPU"
            try:
                gpu_name = torch.cuda.get_device_name(0)
            except:
                pass
            
            error_detail = (
                f"CUDA is available but not compatible with this PyTorch version.\n"
                f"GPU detected: {gpu_name}\n"
                f"This usually happens with very new GPUs (e.g., RTX 5090 with sm_120) that require PyTorch with CUDA 12.8+.\n"
                f"\nTo fix this and use GPU (recommended for faster training):\n"
                f"1. Uninstall current PyTorch: pip uninstall torch torchvision torchaudio\n"
                f"2. Install PyTorch with CUDA 12.8: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128\n"
                f"3. Restart the training\n"
                f"\nFalling back to CPU training (will be slower but will work)."
            )
            return False, error_detail
        # Re-raise other CUDA errors
        raise


def train_lora(
    input_path: str,
    output_dir: str,
    base_model: str = "qwen2.5:7b",
    job_id: str = "default",
    lora_rank: int = 8,
    lora_alpha: int = 16,
    lora_dropout: float = 0.1,
    num_epochs: int = 3,
    batch_size: int = None,  # Will be auto-determined if None
    learning_rate: float = 2e-4,
    max_length: int = 2048
):
    """Train LoRA adapter"""
    
    logger.info(f"Starting LoRA training for job {job_id}")
    logger.info(f"Base model: {base_model}")
    logger.info(f"Input: {input_path}")
    logger.info(f"Output: {output_dir}")
    
    # Load training data
    examples = load_training_data(input_path)
    if len(examples) == 0:
        raise ValueError("No training examples found")
    
    # Load tokenizer and model
    logger.info("Loading tokenizer and model...")
    
    # Test CUDA compatibility first - GPU is preferred for speed
    cuda_usable, cuda_error_msg = test_cuda_compatibility()
    if not cuda_usable and cuda_error_msg:
        logger.warning("=" * 60)
        logger.warning("GPU COMPATIBILITY ISSUE DETECTED")
        logger.warning("=" * 60)
        for line in cuda_error_msg.split('\n'):
            logger.warning(line)
        logger.warning("=" * 60)
    
    # Note: For Ollama models, we need to use the HuggingFace equivalent
    # This is a placeholder - in production, you'd need to map Ollama model names
    # to HuggingFace model names or use a different approach
    hf_model_name = map_ollama_to_hf(base_model)
    
    try:
        tokenizer = AutoTokenizer.from_pretrained(hf_model_name)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        
        # Load model - use CPU if CUDA is not usable
        model = AutoModelForCausalLM.from_pretrained(
            hf_model_name,
            dtype=torch.float16 if cuda_usable else torch.float32,
            device_map="auto" if cuda_usable else None,
            trust_remote_code=True
        )
        
        # Log hardware information
        cuda_available = torch.cuda.is_available()
        cpu_count = multiprocessing.cpu_count()
        
        logger.info("=" * 60)
        logger.info("Hardware Information:")
        logger.info(f"  CPU Cores: {cpu_count}")
        logger.info(f"  CUDA Available: {cuda_available}")
        logger.info(f"  CUDA Usable: {cuda_usable}")
        
        if cuda_available:
            gpu_count = torch.cuda.device_count()
            logger.info(f"  GPU Count: {gpu_count}")
            for i in range(gpu_count):
                try:
                    gpu_name = torch.cuda.get_device_name(i)
                    gpu_props = torch.cuda.get_device_properties(i)
                    gpu_memory = gpu_props.total_memory / (1024**3)  # GB
                    logger.info(f"  GPU {i}: {gpu_name} ({gpu_memory:.2f} GB)")
                except RuntimeError:
                    logger.warning(f"  GPU {i}: Detected but not accessible (compatibility issue)")
            try:
                cuda_version = torch.version.cuda
                logger.info(f"  CUDA Version: {cuda_version}")
            except:
                pass
        
        if not cuda_usable:
            logger.warning("=" * 60)
            logger.warning("[WARNING] TRAINING WILL USE CPU (SLOWER)")
            logger.warning("GPU is not usable - see compatibility warnings above")
            logger.warning("For faster training, please update PyTorch to support your GPU")
            logger.warning("=" * 60)
        else:
            logger.info("[OK] Training will use GPU (fast)")
        logger.info("=" * 60)
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        logger.error("Note: You may need to download the model first or use a different model name")
        raise
    
    # Prepare model for LoRA
    logger.info("Preparing model for LoRA training...")
    try:
        model = prepare_model_for_kbit_training(model)
    except RuntimeError as e:
        error_msg = str(e).lower()
        if "no kernel image" in error_msg or "cuda error" in error_msg:
            logger.warning("CUDA error during model preparation - moving to CPU")
            # Move model to CPU - handle both regular models and models with device_map
            try:
                if hasattr(model, 'to'):
                    model = model.to('cpu')
                elif hasattr(model, 'cpu'):
                    model = model.cpu()
                # Also try to move all parameters to CPU
                if hasattr(model, 'parameters'):
                    for param in model.parameters():
                        if param.is_cuda:
                            param.data = param.data.cpu()
            except Exception as move_error:
                logger.warning(f"Could not move model to CPU: {move_error}")
                logger.warning("Attempting to reload model on CPU...")
                # Reload model on CPU as last resort
                model = AutoModelForCausalLM.from_pretrained(
                    hf_model_name,
                    dtype=torch.float32,
                    device_map=None,
                    trust_remote_code=True
                )
            # Disable CUDA for rest of training
            cuda_usable = False
            # Retry preparation on CPU
            model = prepare_model_for_kbit_training(model)
        else:
            raise
    
    # Configure LoRA
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=lora_rank,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],  # Common for LLMs
        bias="none",
    )
    
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Prepare dataset
    logger.info("Preparing dataset...")
    dataset = prepare_dataset(examples, tokenizer, max_length)
    
    # Determine optimal batch size if not provided
    # Use cuda_usable instead of cuda_available to ensure we use CPU if CUDA is not compatible
    if batch_size is None:
        # Use larger batch size for CPU (more cores available)
        batch_size = 8 if not cuda_usable else 4
        logger.info(f"Auto-determined batch size: {batch_size} ({'CPU' if not cuda_usable else 'GPU'} mode)")
    
    # Determine optimal number of DataLoader workers
    cpu_count = multiprocessing.cpu_count()
    # Use all CPU cores for CPU training, limit to 4 for GPU (to avoid overhead)
    dataloader_num_workers = cpu_count if not cuda_usable else min(4, cpu_count)
    
    logger.info(f"Training configuration:")
    logger.info(f"  Batch size: {batch_size}")
    logger.info(f"  DataLoader workers: {dataloader_num_workers}")
    logger.info(f"  Gradient accumulation steps: 4")
    logger.info(f"  Effective batch size: {batch_size * 4}")
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=4,
        learning_rate=learning_rate,
        fp16=cuda_usable,  # Mixed precision only for GPU
        logging_steps=1,  # Log every step for better progress tracking
        save_steps=50,
        save_total_limit=2,
        warmup_steps=10,
        report_to="none",  # Disable wandb/tensorboard
        log_level="info",  # Ensure info level logging
        # DataLoader optimizations for maximum resource utilization
        dataloader_num_workers=dataloader_num_workers,
        dataloader_pin_memory=cuda_usable,  # Only pin memory for GPU
        dataloader_prefetch_factor=2 if not cuda_usable else None,  # Prefetch for CPU
    )
    
    # Data collator
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False
    )
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=data_collator,
    )
    
    # Train
    logger.info("Starting training...")
    trainer.train()
    
    # Save model
    logger.info(f"Saving model to {output_dir}")
    trainer.save_model()
    tokenizer.save_pretrained(output_dir)
    
    # Save training info
    cuda_available = torch.cuda.is_available()
    cpu_count = multiprocessing.cpu_count()
    
    hardware_info = {
        "cpu_cores": cpu_count,
        "cuda_available": cuda_available,
    }
    
    if cuda_available:
        gpu_count = torch.cuda.device_count()
        hardware_info["gpu_count"] = gpu_count
        hardware_info["gpus"] = []
        for i in range(gpu_count):
            gpu_name = torch.cuda.get_device_name(i)
            gpu_props = torch.cuda.get_device_properties(i)
            gpu_memory = gpu_props.total_memory / (1024**3)  # GB
            hardware_info["gpus"].append({
                "id": i,
                "name": gpu_name,
                "memory_gb": round(gpu_memory, 2)
            })
        try:
            hardware_info["cuda_version"] = torch.version.cuda
        except:
            pass
    
    training_info = {
        "job_id": job_id,
        "base_model": base_model,
        "hf_model": hf_model_name,
        "num_examples": len(examples),
        "lora_rank": lora_rank,
        "lora_alpha": lora_alpha,
        "num_epochs": num_epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "hardware": hardware_info,
    }
    
    with open(os.path.join(output_dir, "training_info.json"), "w") as f:
        json.dump(training_info, f, indent=2)
    
    logger.info("Training completed successfully!")
    return output_dir


def map_ollama_to_hf(ollama_model: str) -> str:
    """Map Ollama model name to HuggingFace model name"""
    # This is a simplified mapping - in production, you'd want a more complete mapping
    mapping = {
        "qwen2.5:7b": "Qwen/Qwen2.5-7B-Instruct",
        "qwen2.5:14b": "Qwen/Qwen2.5-14B-Instruct",
        "llama3.2:3b": "meta-llama/Llama-3.2-3B-Instruct",
        "mistral:7b": "mistralai/Mistral-7B-Instruct-v0.2",
    }
    
    # Remove tag if present (e.g., "qwen2.5:7b" -> "qwen2.5:7b")
    model_key = ollama_model.split(":")[0] + ":" + ollama_model.split(":")[1] if ":" in ollama_model else ollama_model
    
    if model_key in mapping:
        return mapping[model_key]
    
    # Default fallback
    logger.warning(f"Unknown Ollama model {ollama_model}, using default")
    return "Qwen/Qwen2.5-7B-Instruct"


def main():
    parser = argparse.ArgumentParser(description="Train LoRA adapter for TravStats")
    parser.add_argument("--input", required=True, help="Path to JSONL training data")
    parser.add_argument("--output", required=True, help="Output directory for trained model")
    parser.add_argument("--base-model", default="qwen2.5:7b", help="Base Ollama model name")
    parser.add_argument("--job-id", default="default", help="Training job ID")
    parser.add_argument("--lora-rank", type=int, default=8, help="LoRA rank")
    parser.add_argument("--lora-alpha", type=int, default=16, help="LoRA alpha")
    parser.add_argument("--lora-dropout", type=float, default=0.1, help="LoRA dropout")
    parser.add_argument("--num-epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=None, help="Batch size (auto-determined if not provided)")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max-length", type=int, default=2048, help="Max sequence length")
    parser.add_argument("--log-file", help="Path to log file for real-time logging")
    
    args = parser.parse_args()
    
    # Create output directory
    os.makedirs(args.output, exist_ok=True)
    
    # Setup logging to both console and file (if provided)
    # Use UTF-8 encoding for console output to avoid Windows encoding issues
    console_handler = logging.StreamHandler(sys.stdout)
    # Try to set UTF-8 encoding for console (may not work on all Windows terminals)
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass  # If reconfigure fails, continue with default encoding
    
    handlers = [console_handler]
    if args.log_file:
        # Ensure log directory exists
        log_dir = os.path.dirname(args.log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        handlers.append(logging.FileHandler(args.log_file, mode='w', encoding='utf-8'))
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=handlers,
        force=True  # Override any existing configuration
    )
    
    try:
        train_lora(
            input_path=args.input,
            output_dir=args.output,
            base_model=args.base_model,
            job_id=args.job_id,
            lora_rank=args.lora_rank,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            num_epochs=args.num_epochs,
            batch_size=args.batch_size,
            learning_rate=args.learning_rate,
            max_length=args.max_length
        )
        logger.info("Training completed successfully")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

