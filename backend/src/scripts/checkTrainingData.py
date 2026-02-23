#!/usr/bin/env python3
"""
Pre-Training Data Quality Check for TravStats LoRA fine-tuning pipeline.

Usage:
  python checkTrainingData.py --input <jsonl_path> [--output-json]

Outputs a quality report either as human-readable text or as JSON.
"""

import argparse
import json
import sys
from collections import Counter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze JSONL training data quality for LoRA fine-tuning."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to the JSONL training data file",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output analysis as a single JSON object to stdout instead of text",
    )
    return parser.parse_args()


def load_jsonl(filepath: str) -> list[dict]:
    """Load and parse a JSONL file. Returns list of parsed objects."""
    examples = []
    with open(filepath, "r", encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                obj = json.loads(stripped)
                examples.append(obj)
            except json.JSONDecodeError as exc:
                # Report malformed lines but continue
                print(
                    f"Warning: Line {line_number} is not valid JSON and was skipped: {exc}",
                    file=sys.stderr,
                )
    return examples


def compute_analysis(examples: list[dict]) -> dict:
    """
    Compute quality metrics for the given list of training examples.

    Each example is expected to have at least an 'input' and an 'output' field.
    Missing fields are treated as empty strings.
    """
    total: int = len(examples)

    # Collect text lengths
    input_lengths: list[int] = []
    output_lengths: list[int] = []
    input_texts: list[str] = []

    empty_inputs: int = 0
    empty_outputs: int = 0
    short_examples: int = 0

    for example in examples:
        input_text: str = str(example.get("input", "") or "")
        output_text: str = str(example.get("output", "") or "")

        input_len = len(input_text)
        output_len = len(output_text)

        input_lengths.append(input_len)
        output_lengths.append(output_len)
        input_texts.append(input_text)

        if input_len == 0:
            empty_inputs += 1
        if output_len == 0:
            empty_outputs += 1
        if (input_len + output_len) < 100:
            short_examples += 1

    # Detect duplicates (same input text)
    input_counter = Counter(input_texts)
    duplicates: int = sum(count - 1 for count in input_counter.values() if count > 1)

    # Aggregate length statistics
    if total > 0:
        avg_input_length: float = round(sum(input_lengths) / total, 2)
        min_input_length: int = min(input_lengths)
        max_input_length: int = max(input_lengths)
        avg_output_length: float = round(sum(output_lengths) / total, 2)
        min_output_length: int = min(output_lengths)
        max_output_length: int = max(output_lengths)
    else:
        avg_input_length = 0.0
        min_input_length = 0
        max_input_length = 0
        avg_output_length = 0.0
        min_output_length = 0
        max_output_length = 0

    # Build issue list
    issues: list[str] = []
    if total == 0:
        issues.append("No training examples found in file")
    if duplicates > 0:
        issues.append(f"{duplicates} duplicate example(s) detected")
    if empty_inputs > 0:
        issues.append(f"{empty_inputs} example(s) with empty input")
    if empty_outputs > 0:
        issues.append(f"{empty_outputs} example(s) with empty output")
    if short_examples > 0:
        issues.append(f"{short_examples} short example(s) (combined length < 100 chars)")
    if total < 10:
        issues.append(f"Very few examples ({total}); at least 10 recommended for meaningful training")

    # Quality score: start at 100, deduct for issues
    quality_score: int = 100
    if total == 0:
        quality_score = 0
    else:
        # Deduct proportionally for duplicates (up to -20)
        if duplicates > 0:
            duplicate_ratio = min(duplicates / total, 1.0)
            quality_score -= int(duplicate_ratio * 20)

        # Deduct for empty inputs/outputs (up to -25 each)
        if empty_inputs > 0:
            empty_input_ratio = min(empty_inputs / total, 1.0)
            quality_score -= int(empty_input_ratio * 25)
        if empty_outputs > 0:
            empty_output_ratio = min(empty_outputs / total, 1.0)
            quality_score -= int(empty_output_ratio * 25)

        # Deduct for too many short examples (up to -20)
        if short_examples > 0:
            short_ratio = min(short_examples / total, 1.0)
            quality_score -= int(short_ratio * 20)

        # Deduct for very few total examples (up to -10)
        if total < 10:
            quality_score -= max(0, 10 - total)

    quality_score = max(0, quality_score)

    # Estimated training time: 2 minutes per example on CPU baseline
    estimated_training_minutes: float = total * 2.0

    return {
        "total_examples": total,
        "duplicates": duplicates,
        "avg_input_length": avg_input_length,
        "min_input_length": min_input_length,
        "max_input_length": max_input_length,
        "avg_output_length": avg_output_length,
        "min_output_length": min_output_length,
        "max_output_length": max_output_length,
        "empty_inputs": empty_inputs,
        "empty_outputs": empty_outputs,
        "short_examples": short_examples,
        "issues": issues,
        "quality_score": quality_score,
        "estimated_training_minutes": estimated_training_minutes,
    }


def print_text_report(analysis: dict, filepath: str) -> None:
    """Print a human-readable quality report to stdout."""
    sep = "-" * 50
    print(sep)
    print("TravStats Training Data Quality Report")
    print(sep)
    print(f"File: {filepath}")
    print(f"Total examples      : {analysis['total_examples']}")
    print(f"Duplicates          : {analysis['duplicates']}")
    print()
    print("Input lengths:")
    print(f"  avg               : {analysis['avg_input_length']}")
    print(f"  min               : {analysis['min_input_length']}")
    print(f"  max               : {analysis['max_input_length']}")
    print()
    print("Output lengths:")
    print(f"  avg               : {analysis['avg_output_length']}")
    print(f"  min               : {analysis['min_output_length']}")
    print(f"  max               : {analysis['max_output_length']}")
    print()
    print(f"Empty inputs        : {analysis['empty_inputs']}")
    print(f"Empty outputs       : {analysis['empty_outputs']}")
    print(f"Short examples      : {analysis['short_examples']}")
    print()
    print(f"Quality score       : {analysis['quality_score']} / 100")
    print(f"Est. training time  : {analysis['estimated_training_minutes']} minutes")
    print()
    if analysis["issues"]:
        print("Issues detected:")
        for issue in analysis["issues"]:
            print(f"  - {issue}")
    else:
        print("No issues detected.")
    print(sep)


def main() -> None:
    args = parse_args()

    try:
        examples = load_jsonl(args.input)
    except FileNotFoundError:
        print(f"Error: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"Error reading file: {exc}", file=sys.stderr)
        sys.exit(1)

    analysis = compute_analysis(examples)

    if args.output_json:
        print(json.dumps(analysis))
    else:
        print_text_report(analysis, args.input)


if __name__ == "__main__":
    main()
