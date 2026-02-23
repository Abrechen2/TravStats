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
import signal
import atexit
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional

# Setup logging - will be configured after parsing args to write to log file
logger = logging.getLogger(__name__)

# Global flag for cancellation
_cancellation_requested = False
_trainer_instance: Optional[Any] = None
_output_dir: Optional[str] = None

try:
    from transformers import (
        AutoTokenizer,
        AutoModelForCausalLM,
        TrainingArguments,
        Trainer,
        DataCollatorForLanguageModeling,
        BitsAndBytesConfig
    )
    from peft import (
        LoraConfig,
        get_peft_model,
        prepare_model_for_kbit_training,
        PeftModel,
        TaskType
    )
    from datasets import Dataset
    import torch
except ImportError as e:
    logger.error(f"Required packages not installed: {e}")
    logger.error("Please install: pip install transformers peft datasets torch bitsandbytes")
    sys.exit(1)


def validate_training_data(examples: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """Validate training data format and structure
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if len(examples) == 0:
        return False, "No training examples found in file"
    
    if len(examples) < 3:
        return False, f"Insufficient training examples: {len(examples)}. Need at least 3 examples for meaningful training."
    
    # Validate each example
    required_fields = ['instruction', 'input', 'output']
    for i, example in enumerate(examples):
        if not isinstance(example, dict):
            return False, f"Example {i} is not a dictionary"
        
        # Check required fields
        for field in required_fields:
            if field not in example:
                return False, f"Example {i} is missing required field: {field}"
            
            if not isinstance(example[field], str):
                return False, f"Example {i} field '{field}' must be a string"
            
            if len(example[field].strip()) == 0:
                return False, f"Example {i} field '{field}' is empty"
        
        # Check metadata (optional but should be dict if present)
        if 'metadata' in example and not isinstance(example['metadata'], dict):
            return False, f"Example {i} metadata must be a dictionary"
    
    # Check data quality
    total_length = sum(len(ex['input']) + len(ex['output']) for ex in examples)
    avg_length = total_length / len(examples)
    
    if avg_length < 50:
        logger.warning(f"Average example length is very short ({avg_length:.1f} chars). Training may not be effective.")
    
    if avg_length > 10000:
        logger.warning(f"Average example length is very long ({avg_length:.1f} chars). This may cause memory issues.")
    
    return True, ""


def load_training_data(jsonl_path: str) -> List[Dict[str, Any]]:
    """Load and validate training data from JSONL file"""
    if not os.path.exists(jsonl_path):
        raise FileNotFoundError(f"Training data file not found: {jsonl_path}")
    
    # Check file size
    file_size = os.path.getsize(jsonl_path)
    if file_size == 0:
        raise ValueError(f"Training data file is empty: {jsonl_path}")
    
    if file_size > 100 * 1024 * 1024:  # 100MB
        logger.warning(f"Training data file is very large ({file_size / (1024*1024):.1f} MB). This may cause memory issues.")
    
    examples = []
    line_number = 0
    errors = []
    
    try:
        with open(jsonl_path, 'r', encoding='utf-8') as f:
            for line_number, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                
                try:
                    example = json.loads(line)
                    examples.append(example)
                except json.JSONDecodeError as e:
                    errors.append(f"Line {line_number}: Invalid JSON - {str(e)}")
                    if len(errors) > 10:  # Limit error messages
                        break
    except UnicodeDecodeError as e:
        raise ValueError(f"File encoding error at line {line_number}: {str(e)}. File must be UTF-8 encoded.")
    except Exception as e:
        raise ValueError(f"Error reading training data file: {str(e)}")
    
    if errors:
        error_msg = f"Found {len(errors)} JSON parsing errors:\n" + "\n".join(errors[:10])
        if len(errors) > 10:
            error_msg += f"\n... and {len(errors) - 10} more errors"
        raise ValueError(error_msg)
    
    logger.info(f"Loaded {len(examples)} training examples from {jsonl_path}")
    
    # Validate data structure
    is_valid, error_message = validate_training_data(examples)
    if not is_valid:
        raise ValueError(f"Training data validation failed: {error_message}")
    
    logger.info("Training data validation passed")
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
                        # Convert flight_index to int if it's a string
                        try:
                            flight_num = int(flight_index) + 1
                        except (ValueError, TypeError):
                            flight_num = flight_index
                        annotation_section += f"\nFlug {flight_num}:\n"
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


def signal_handler(signum, frame):
    """Handle SIGTERM and SIGINT signals for graceful shutdown"""
    global _cancellation_requested, _trainer_instance, _output_dir
    
    signal_name = signal.Signals(signum).name
    logger.warning(f"Received {signal_name} signal. Initiating graceful shutdown...")
    
    _cancellation_requested = True
    
    # If trainer is available, try to save checkpoint
    if _trainer_instance is not None and _output_dir is not None:
        try:
            logger.info("Saving checkpoint before shutdown...")
            checkpoint_dir = os.path.join(_output_dir, "checkpoint-cancelled")
            os.makedirs(checkpoint_dir, exist_ok=True)
            _trainer_instance.save_model(checkpoint_dir)
            logger.info(f"Checkpoint saved to {checkpoint_dir}")
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")
    
    # Cleanup resources
    cleanup_resources()
    
    logger.warning("Training cancelled by user signal")
    sys.exit(130 if signum == signal.SIGINT else 143)  # Standard exit codes for SIGINT/SIGTERM


def cleanup_resources():
    """Clean up GPU memory and other resources"""
    global _trainer_instance, _output_dir
    
    try:
        # Clear GPU cache if available
        if 'torch' in sys.modules:
            import torch
            import gc
            
            # Clear trainer references
            if _trainer_instance is not None:
                try:
                    # Delete trainer to free model references
                    del _trainer_instance
                    _trainer_instance = None
                except Exception as e:
                    logger.warning(f"Error deleting trainer instance: {e}")
            
            # Clear CUDA cache
            if torch.cuda.is_available():
                try:
                    # Synchronize all CUDA operations
                    torch.cuda.synchronize()
                    # Clear cache
                    torch.cuda.empty_cache()
                    # Reset peak memory stats
                    torch.cuda.reset_peak_memory_stats()
                    logger.info("GPU memory cache cleared and synchronized")
                except Exception as e:
                    logger.warning(f"Error clearing GPU cache: {e}")
            
            # Force garbage collection
            gc.collect()
            
            # Additional cleanup for CUDA
            if torch.cuda.is_available():
                try:
                    # Run another garbage collection after CUDA cleanup
                    gc.collect()
                    torch.cuda.empty_cache()
                except Exception:
                    pass
            
            logger.info("Resource cleanup completed")
    except Exception as e:
        logger.warning(f"Error during resource cleanup: {e}")


def register_signal_handlers():
    """Register signal handlers for graceful shutdown"""
    # Register handlers for SIGTERM and SIGINT
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    # Also register atexit handler for cleanup
    atexit.register(cleanup_resources)
    
    logger.info("Signal handlers registered for graceful shutdown")


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
    max_length: int = 2048,
    previous_model_path: Optional[str] = None
):
    """Train LoRA adapter"""
    global _cancellation_requested, _trainer_instance, _output_dir
    
    # Set global variables for signal handler
    _output_dir = output_dir
    _cancellation_requested = False
    
    # Register signal handlers
    register_signal_handlers()
    
    logger.info(f"Starting LoRA training for job {job_id}")
    logger.info(f"Base model: {base_model}")
    logger.info(f"Input: {input_path}")
    logger.info(f"Output: {output_dir}")
    if previous_model_path:
        logger.info(f"Continuing training from previous model: {previous_model_path}")
        if not os.path.exists(previous_model_path):
            raise ValueError(f"Previous model path does not exist: {previous_model_path}")
    else:
        logger.info("Starting new training from base model")
    
    # Load and validate training data
    try:
        examples = load_training_data(input_path)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        logger.error(f"Failed to load or validate training data: {e}")
        raise
    
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
    
    # Retry logic for model loading (handles network issues)
    max_retries = 3
    retry_delay = 5  # seconds
    
    tokenizer = None
    model = None
    use_quantization = False
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Loading tokenizer and model (attempt {attempt + 1}/{max_retries})...")
            logger.info(f"HuggingFace model: {hf_model_name}")
            
            # Load tokenizer
            try:
                tokenizer = AutoTokenizer.from_pretrained(
                    hf_model_name,
                    trust_remote_code=True
                )
                if tokenizer.pad_token is None:
                    tokenizer.pad_token = tokenizer.eos_token
                logger.info("Tokenizer loaded successfully")
            except TypeError as e:
                # TypeError usually means invalid arguments - don't retry
                error_msg = str(e).lower()
                if "unexpected keyword argument" in error_msg:
                    raise ValueError(f"Invalid argument for tokenizer loading: {e}. This may be a compatibility issue with the transformers library version.")
                else:
                    raise ValueError(f"Type error loading tokenizer: {e}. Check tokenizer compatibility.")
            except Exception as e:
                error_msg = str(e).lower()
                if "connection" in error_msg or "timeout" in error_msg or "network" in error_msg:
                    if attempt < max_retries - 1:
                        logger.warning(f"Network error loading tokenizer (attempt {attempt + 1}): {e}")
                        logger.info(f"Retrying in {retry_delay} seconds...")
                        import time
                        time.sleep(retry_delay)
                        continue
                    else:
                        raise ValueError(f"Failed to load tokenizer after {max_retries} attempts. Network error: {e}")
                else:
                    raise ValueError(f"Failed to load tokenizer: {e}. Make sure the model name '{hf_model_name}' is correct and accessible.")
            
            # Load model - use 8-bit quantization for GPU to reduce memory usage
            use_quantization = False
            try:
                if cuda_usable:
                    # Use 8-bit quantization for GPU to reduce memory usage
                    quantization_config = BitsAndBytesConfig(
                        load_in_8bit=True,
                        llm_int8_threshold=6.0,
                        llm_int8_has_fp16_weight=False
                    )
                    model = AutoModelForCausalLM.from_pretrained(
                        hf_model_name,
                        quantization_config=quantization_config,
                        device_map="auto",
                        trust_remote_code=True
                    )
                    use_quantization = True
                    logger.info("Model loaded successfully with 8-bit quantization (GPU)")
                else:
                    # CPU training - no quantization
                    model = AutoModelForCausalLM.from_pretrained(
                        hf_model_name,
                        dtype=torch.float32,
                        device_map=None,
                        trust_remote_code=True
                    )
                    logger.info("Model loaded successfully (CPU)")
                break  # Success, exit retry loop
            except TypeError as e:
                # TypeError usually means invalid arguments - don't retry
                error_msg = str(e).lower()
                if "unexpected keyword argument" in error_msg:
                    raise ValueError(f"Invalid argument for model loading: {e}. This may be a compatibility issue with the transformers library version.")
                else:
                    raise ValueError(f"Type error loading model: {e}. Check model compatibility.")
            except Exception as e:
                error_msg = str(e).lower()
                if "connection" in error_msg or "timeout" in error_msg or "network" in error_msg:
                    if attempt < max_retries - 1:
                        logger.warning(f"Network error loading model (attempt {attempt + 1}): {e}")
                        logger.info(f"Retrying in {retry_delay} seconds...")
                        import time
                        time.sleep(retry_delay)
                        continue
                    else:
                        raise ValueError(f"Failed to load model after {max_retries} attempts. Network error: {e}. Please check your internet connection and try again.")
                elif "out of memory" in error_msg or "cuda" in error_msg:
                    raise ValueError(f"GPU memory error: {e}. Try using a smaller model or reduce batch size.")
                elif "not found" in error_msg or "does not exist" in error_msg:
                    raise ValueError(f"Model not found: {e}. The model '{hf_model_name}' may not exist or may not be accessible. Check the model name.")
                else:
                    raise ValueError(f"Failed to load model: {e}. Check model name and compatibility.")
        
        except ValueError:
            # Re-raise ValueError (these are our custom errors)
            raise
        except Exception as e:
            if attempt < max_retries - 1:
                logger.warning(f"Unexpected error loading model (attempt {attempt + 1}): {e}")
                logger.info(f"Retrying in {retry_delay} seconds...")
                import time
                time.sleep(retry_delay)
            else:
                raise ValueError(f"Failed to load model after {max_retries} attempts: {e}")
    
    if tokenizer is None or model is None:
        raise ValueError("Failed to load tokenizer or model after all retry attempts")
    
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
    
    # Prepare model for LoRA
    logger.info("Preparing model for LoRA training...")
    try:
        # Only prepare for kbit training if using quantization (8-bit)
        if use_quantization:
            model = prepare_model_for_kbit_training(model)
            logger.info("Model prepared for LoRA training with quantization successfully")
        else:
            logger.info("Model prepared for LoRA training successfully (no quantization)")
    except RuntimeError as e:
        error_msg = str(e).lower()
        if "no kernel image" in error_msg or "cuda error" in error_msg or "cuda out of memory" in error_msg:
            logger.warning("CUDA error during model preparation - attempting to move to CPU")
            logger.warning(f"Error details: {e}")
            
            # Move model to CPU - handle both regular models and models with device_map
            try:
                if hasattr(model, 'to'):
                    model = model.to('cpu')
                    logger.info("Model moved to CPU successfully")
                elif hasattr(model, 'cpu'):
                    model = model.cpu()
                    logger.info("Model moved to CPU successfully")
                else:
                    # Try to move all parameters to CPU
                    if hasattr(model, 'parameters'):
                        for param in model.parameters():
                            if param.is_cuda:
                                param.data = param.data.cpu()
                        logger.info("Model parameters moved to CPU successfully")
            except Exception as move_error:
                logger.warning(f"Could not move model to CPU: {move_error}")
                logger.warning("Attempting to reload model on CPU...")
                try:
                    # Reload model on CPU as last resort
                    model = AutoModelForCausalLM.from_pretrained(
                        hf_model_name,
                        dtype=torch.float32,
                        device_map=None,
                        trust_remote_code=True,
                        timeout=300
                    )
                    logger.info("Model reloaded on CPU successfully")
                except Exception as reload_error:
                    raise ValueError(f"Failed to move model to CPU and reload failed: {reload_error}. Original error: {e}")
            
            # Disable CUDA for rest of training
            cuda_usable = False
            use_quantization = False  # CPU training doesn't use quantization
            logger.warning("Switching to CPU training mode")
            
            # Retry preparation on CPU (no quantization needed)
            logger.info("Model prepared for LoRA training on CPU successfully")
        else:
            raise ValueError(f"Failed to prepare model for LoRA training: {e}")
    except Exception as e:
        raise ValueError(f"Unexpected error preparing model for LoRA training: {e}")
    
    # Load previous LoRA adapter if continuing training, otherwise create new LoRA config
    if previous_model_path:
        logger.info(f"Loading previous LoRA adapter from {previous_model_path}")
        try:
            # Load the previous LoRA adapter
            model = PeftModel.from_pretrained(model, previous_model_path)
            logger.info("Previous LoRA adapter loaded successfully")
            # Ensure model is in training mode
            model.train()
            model.print_trainable_parameters()
        except Exception as e:
            logger.error(f"Failed to load previous LoRA adapter: {e}")
            raise ValueError(f"Failed to load previous LoRA adapter from {previous_model_path}: {e}")
    else:
        # Configure new LoRA adapter
        logger.info("Creating new LoRA adapter")
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=lora_rank,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],  # Common for LLMs
            bias="none",
        )
        
        model = get_peft_model(model, lora_config)
        # Ensure model is in training mode
        model.train()
        model.print_trainable_parameters()
    
    # Verify that LoRA parameters are trainable
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    if trainable_params == 0:
        raise ValueError("No trainable parameters found! LoRA configuration may be incorrect.")
    logger.info(f"Verified {trainable_params:,} trainable parameters")
    
    # Prepare dataset
    logger.info("Preparing dataset...")
    dataset = prepare_dataset(examples, tokenizer, max_length)
    
    # Determine optimal batch size if not provided
    # Use cuda_usable instead of cuda_available to ensure we use CPU if CUDA is not compatible
    if batch_size is None:
        # Be conservative on GPU to avoid OOM; CPU can handle a bit more
        batch_size = 8 if not cuda_usable else 1
        logger.info(f"Auto-determined batch size: {batch_size} ({'CPU' if not cuda_usable else 'GPU'} mode)")

    # Gradient accumulation (lower to reduce activation memory)
    gradient_accum_steps = 1 if cuda_usable else 2
    
    # Determine optimal number of DataLoader workers
    cpu_count = multiprocessing.cpu_count()
    # Use all CPU cores for CPU training, limit to 4 for GPU (to avoid overhead)
    dataloader_num_workers = cpu_count if not cuda_usable else min(4, cpu_count)
    
    logger.info(f"Training configuration:")
    logger.info(f"  Batch size: {batch_size}")
    logger.info(f"  DataLoader workers: {dataloader_num_workers}")
    logger.info(f"  Gradient accumulation steps: {gradient_accum_steps}")
    logger.info(f"  Effective batch size: {batch_size * gradient_accum_steps}")
    
    # Calculate optimal save_steps based on dataset size
    # Save checkpoints more frequently for smaller datasets
    total_steps = len(dataset) // (batch_size * gradient_accum_steps) * num_epochs  # adjusted for gradient_accum_steps
    if total_steps < 100:
        save_steps = max(10, total_steps // 10)  # Save 10 times during training
    elif total_steps < 500:
        save_steps = 50  # Default
    else:
        save_steps = max(50, total_steps // 20)  # Save 20 times during training
    
    logger.info(f"Training will save checkpoints every {save_steps} steps (total steps: ~{total_steps})")
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=gradient_accum_steps,
        learning_rate=learning_rate,
        fp16=cuda_usable and not use_quantization,  # Mixed precision only for GPU, not with quantization
        logging_steps=1,  # Log every step for better progress tracking
        save_steps=save_steps,  # Save checkpoint every N steps
        save_total_limit=3,  # Keep last 3 checkpoints (for recovery)
        warmup_steps=10,
        report_to="none",  # Disable wandb/tensorboard
        log_level="info",  # Ensure info level logging
        # DataLoader optimizations for maximum resource utilization
        dataloader_num_workers=dataloader_num_workers,
        dataloader_pin_memory=cuda_usable,  # Only pin memory for GPU
        dataloader_prefetch_factor=2 if not cuda_usable else None,  # Prefetch for CPU
        # Enable checkpointing for recovery
        load_best_model_at_end=False,
        save_strategy="steps",
        # Gradient checkpointing disabled - not compatible with LoRA/PEFT
        # LoRA is already memory-efficient, so checkpointing is not needed
        gradient_checkpointing=False,
        # Resume from checkpoint if available
        resume_from_checkpoint=None,  # Can be set to checkpoint path to resume
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
    
    # Store trainer instance globally for signal handler
    _trainer_instance = trainer
    
    # Train with cancellation check
    logger.info("Starting training...")
    logger.info(f"Checkpoints will be saved to: {output_dir}")
    logger.info("Training can be resumed from the latest checkpoint if interrupted")
    
    try:
        trainer.train()
        
        # Check if cancellation was requested
        if _cancellation_requested:
            logger.warning("Training was cancelled, saving final checkpoint...")
            checkpoint_dir = os.path.join(output_dir, "checkpoint-cancelled")
            os.makedirs(checkpoint_dir, exist_ok=True)
            try:
                trainer.save_model(checkpoint_dir)
                tokenizer.save_pretrained(checkpoint_dir)
                logger.info(f"Final checkpoint saved to {checkpoint_dir}")
                logger.info("You can resume training from this checkpoint if needed")
            except Exception as save_error:
                logger.error(f"Failed to save cancellation checkpoint: {save_error}")
            raise KeyboardInterrupt("Training cancelled by user")
        
        # Save final model
        logger.info(f"Saving final model to {output_dir}")
        trainer.save_model()
        tokenizer.save_pretrained(output_dir)
        logger.info("Final model saved successfully")
        
        # Capture training metrics from trainer state
        train_metrics: Dict[str, Any] = {}
        if hasattr(trainer, 'state') and trainer.state is not None:
            state = trainer.state
            train_metrics['final_loss'] = state.log_history[-1].get('loss') if state.log_history else None
            train_metrics['total_steps'] = state.global_step
            train_metrics['epochs_completed'] = state.epoch
            train_metrics['log_history'] = state.log_history[-10:]  # Last 10 log entries
    except KeyboardInterrupt:
        # Handle keyboard interrupt gracefully
        if _cancellation_requested:
            logger.warning("Training cancelled by user signal")
            checkpoint_dir = os.path.join(output_dir, "checkpoint-cancelled")
            os.makedirs(checkpoint_dir, exist_ok=True)
            try:
                trainer.save_model(checkpoint_dir)
                tokenizer.save_pretrained(checkpoint_dir)
                logger.info(f"Checkpoint saved to {checkpoint_dir}")
            except Exception as e:
                logger.error(f"Failed to save checkpoint: {e}")
        raise
    except Exception as e:
        # Log error and cleanup
        logger.error(f"Training failed with error: {e}", exc_info=True)
        raise
    finally:
        # Always cleanup resources, even on error
        logger.info("Cleaning up resources...")
        try:
            # Delete model and trainer references before cleanup
            if 'model' in locals():
                try:
                    del model
                except:
                    pass
            if 'trainer' in locals():
                try:
                    del trainer
                except:
                    pass
            if 'tokenizer' in locals():
                try:
                    del tokenizer
                except:
                    pass
            
            # Run cleanup
            cleanup_resources()
        except Exception as cleanup_error:
            logger.warning(f"Error during final cleanup: {cleanup_error}")
        finally:
            # Reset global variables
            _trainer_instance = None
            _output_dir = None
    
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
        "train_metrics": train_metrics,
    }
    
    with open(os.path.join(output_dir, "training_info.json"), "w") as f:
        json.dump(training_info, f, indent=2)
    
    logger.info("Training completed successfully!")
    
    # Output structured metrics to stdout for TypeScript to parse
    metrics_output = {
        "final_loss": train_metrics.get('final_loss'),
        "total_steps": train_metrics.get('total_steps'),
        "epochs_completed": train_metrics.get('epochs_completed'),
        "num_examples": len(examples),
        "lora_rank": lora_rank,
        "num_epochs": num_epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "log_history": train_metrics.get('log_history', []),
    }
    print(f"METRICS_JSON:{json.dumps(metrics_output)}", flush=True)
    
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
    parser.add_argument("--previous-model-path", default=None, help="Path to previous trained model to continue training from")
    
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
            max_length=args.max_length,
            previous_model_path=args.previous_model_path
        )
        logger.info("Training completed successfully")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

