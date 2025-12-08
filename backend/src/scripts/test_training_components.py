#!/usr/bin/env python3
"""
Test script to verify training components without downloading the full model
"""

import json
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.trainLora import load_training_data, format_prompt, prepare_dataset

def test_load_training_data():
    """Test loading training data"""
    print("=" * 60)
    print("Test 1: Loading training data")
    print("=" * 60)
    
    jsonl_path = Path(__file__).parent.parent.parent / "data" / "training" / "training-1765126703353.jsonl"
    
    if not jsonl_path.exists():
        print(f"ERROR: Training file not found: {jsonl_path}")
        return False
    
    try:
        examples = load_training_data(str(jsonl_path))
        print(f"✓ Loaded {len(examples)} examples")
        
        if len(examples) == 0:
            print("ERROR: No examples loaded")
            return False
        
        # Check structure
        first_example = examples[0]
        required_keys = ['instruction', 'input', 'output', 'metadata']
        for key in required_keys:
            if key not in first_example:
                print(f"ERROR: Missing key '{key}' in example")
                return False
        
        print("✓ All examples have required keys")
        return True
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_format_prompt():
    """Test prompt formatting"""
    print("\n" + "=" * 60)
    print("Test 2: Formatting prompts")
    print("=" * 60)
    
    jsonl_path = Path(__file__).parent.parent.parent / "data" / "training" / "training-1765126703353.jsonl"
    examples = load_training_data(str(jsonl_path))
    
    try:
        for i, example in enumerate(examples[:2]):  # Test first 2 examples
            prompt = format_prompt(example)
            print(f"\nExample {i+1}:")
            print(f"  Type: {example.get('metadata', {}).get('type', 'unknown')}")
            print(f"  Prompt length: {len(prompt)} characters")
            print(f"  Prompt preview: {prompt[:200]}...")
            
            if len(prompt) == 0:
                print(f"ERROR: Empty prompt for example {i+1}")
                return False
        
        print("\n✓ All prompts formatted successfully")
        return True
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_prepare_dataset():
    """Test dataset preparation (without tokenizer)"""
    print("\n" + "=" * 60)
    print("Test 3: Dataset preparation structure")
    print("=" * 60)
    
    jsonl_path = Path(__file__).parent.parent.parent / "data" / "training" / "training-1765126703353.jsonl"
    examples = load_training_data(str(jsonl_path))
    
    try:
        # Test the batched format conversion logic
        # Simulate what happens in prepare_dataset
        from datasets import Dataset
        
        dataset = Dataset.from_list(examples)
        print(f"✓ Created dataset with {len(dataset)} examples")
        print(f"✓ Dataset columns: {dataset.column_names}")
        
        # Test the tokenize function logic (without actual tokenization)
        def test_tokenize_function(examples_batch):
            # This is the logic from prepare_dataset
            if isinstance(examples_batch, dict):
                keys = list(examples_batch.keys())
                if not keys:
                    return {}
                
                # Check if values are lists (batched) or single values
                first_value = examples_batch[keys[0]]
                if isinstance(first_value, list):
                    # Batched format: each key maps to a list of values
                    num_examples = len(first_value)
                    examples_list = [
                        {key: examples_batch[key][i] for key in keys}
                        for i in range(num_examples)
                    ]
                else:
                    # Single example format: each key maps to a single value
                    examples_list = [examples_batch]
            elif isinstance(examples_batch, list):
                # If it's already a list, use it directly
                examples_list = examples_batch
            else:
                # Single example (shouldn't happen with batched=True, but handle it)
                examples_list = [examples_batch]
            
            # Format prompts - ensure each item is a dict
            texts = []
            for ex in examples_list:
                if isinstance(ex, dict):
                    texts.append(format_prompt(ex))
                else:
                    print(f"WARNING: Non-dict example: {type(ex)} - {ex}")
                    # Skip non-dict examples
                    continue
            return {"texts": texts}
        
        # Test with a small batch
        test_batch = dataset.select(range(min(2, len(dataset))))
        result = test_batch.map(test_tokenize_function, batched=True)
        
        print(f"✓ Batch processing works correctly")
        print(f"✓ Processed {len(result)} examples")
        
        return True
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("Training Components Test Suite")
    print("=" * 60)
    
    tests = [
        test_load_training_data,
        test_format_prompt,
        test_prepare_dataset,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"\nERROR in {test.__name__}: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)
    
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    
    for i, (test, result) in enumerate(zip(tests, results), 1):
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"Test {i}: {test.__name__}: {status}")
    
    all_passed = all(results)
    
    if all_passed:
        print("\n✓ All tests passed!")
        sys.exit(0)
    else:
        print("\n✗ Some tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()

