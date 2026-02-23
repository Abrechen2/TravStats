#!/usr/bin/env python3
# Model Evaluation Script for TravStats
# Tests deployed Ollama model against sample examples and reports accuracy metrics.
# Usage: python evalModel.py --model-name <name> --test-data <jsonl> --ollama-url <url> --output-json

import argparse
import json
import random
import sys
import urllib.request
import urllib.error


EVAL_FIELDS = ["flightNumber", "departureCode", "arrivalCode", "departureDate", "airline"]
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_SAMPLE_SIZE = 10
MAX_SAMPLE_SIZE = 20
REQUEST_TIMEOUT_SECONDS = 30


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate a deployed Ollama model against test examples")
    parser.add_argument("--model-name", required=True, help="Ollama model name to test")
    parser.add_argument("--test-data", required=True, help="Path to JSONL file")
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL, help="Ollama API URL")
    parser.add_argument("--sample-size", type=int, default=DEFAULT_SAMPLE_SIZE, help="Number of examples to test")
    parser.add_argument("--output-json", action="store_true", help="Print JSON result to stdout")
    return parser.parse_args()


def load_examples(jsonl_path, sample_size):
    examples = []
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    examples.append(json.loads(stripped))
                except json.JSONDecodeError:
                    continue
    except OSError as exc:
        raise RuntimeError("Failed to read test data file {!r}: {}".format(jsonl_path, exc)) from exc
    capped_size = min(sample_size, MAX_SAMPLE_SIZE)
    if len(examples) > capped_size:
        examples = random.sample(examples, capped_size)
    return examples


def call_ollama(ollama_url, model_name, prompt):
    payload = json.dumps({"model": model_name, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request(
        "{}/api/generate".format(ollama_url),
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
            return parsed.get("response", "")
    except urllib.error.URLError:
        return None
    except (json.JSONDecodeError, OSError):
        return None


def extract_json_from_text(text):
    if not text:
        return None
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    return None


def compare_field(expected_value, actual_value):
    if expected_value is None and actual_value is None:
        return True
    if expected_value is None or actual_value is None:
        return False
    return str(expected_value).strip().lower() == str(actual_value).strip().lower()


def evaluate_example(expected_output, actual_response):
    field_matches = {field: False for field in EVAL_FIELDS}
    if actual_response is None:
        return False, field_matches
    actual_data = extract_json_from_text(actual_response)
    if actual_data is None:
        return False, field_matches
    expected_data = extract_json_from_text(expected_output) if expected_output else None
    if expected_data is None:
        return True, field_matches
    for field in EVAL_FIELDS:
        field_matches[field] = compare_field(expected_data.get(field), actual_data.get(field))
    return True, field_matches


def run_evaluation(model_name, ollama_url, examples):
    if not examples:
        return build_result(model_name=model_name, samples_tested=0, response_count=0,
            field_totals={field: 0 for field in EVAL_FIELDS}, issues=["No test examples available"])
    response_count = 0
    field_totals = {field: 0 for field in EVAL_FIELDS}
    issues = []
    no_response_count = 0
    bad_json_count = 0
    for example in examples:
        prompt = example.get("input", "")
        expected_output = example.get("output", "")
        actual_response = call_ollama(ollama_url, model_name, prompt)
        got_valid, field_matches = evaluate_example(expected_output, actual_response)
        if actual_response is None:
            no_response_count += 1
        elif not got_valid:
            bad_json_count += 1
        else:
            response_count += 1
            for field, matched in field_matches.items():
                if matched:
                    field_totals[field] += 1
    if no_response_count > 0:
        issues.append("{} examples got no response from Ollama".format(no_response_count))
    if bad_json_count > 0:
        issues.append("{} examples got no valid JSON response".format(bad_json_count))
    return build_result(model_name=model_name, samples_tested=len(examples),
        response_count=response_count, field_totals=field_totals, issues=issues)


def build_result(model_name, samples_tested, response_count, field_totals, issues):
    response_rate = response_count / samples_tested if samples_tested > 0 else 0.0
    if response_count > 0:
        field_scores = {field: field_totals[field] / samples_tested for field in EVAL_FIELDS}
        field_accuracy = sum(field_scores.values()) / len(EVAL_FIELDS)
    else:
        field_scores = {field: 0.0 for field in EVAL_FIELDS}
        field_accuracy = 0.0
    overall_score = round((response_rate * 0.3 + field_accuracy * 0.7) * 100)
    return {
        "model_name": model_name,
        "samples_tested": samples_tested,
        "response_rate": round(response_rate, 4),
        "field_accuracy": round(field_accuracy, 4),
        "field_scores": {k: round(v, 4) for k, v in field_scores.items()},
        "overall_score": overall_score,
        "issues": issues,
    }


def check_ollama_available(ollama_url):
    try:
        with urllib.request.urlopen("{}/api/tags".format(ollama_url), timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


def main():
    args = parse_args()
    sample_size = max(1, min(args.sample_size, MAX_SAMPLE_SIZE))
    if not check_ollama_available(args.ollama_url):
        result = {
            "model_name": args.model_name,
            "samples_tested": 0,
            "response_rate": 0.0,
            "field_accuracy": 0.0,
            "field_scores": {field: 0.0 for field in EVAL_FIELDS},
            "overall_score": 0,
            "issues": ["Ollama is not available at {}".format(args.ollama_url)],
        }
        if args.output_json:
            print(json.dumps(result))
        else:
            print("ERROR: Ollama not available at {}".format(args.ollama_url), file=sys.stderr)
        sys.exit(0)
    try:
        examples = load_examples(args.test_data, sample_size)
    except RuntimeError as exc:
        result = {
            "model_name": args.model_name,
            "samples_tested": 0,
            "response_rate": 0.0,
            "field_accuracy": 0.0,
            "field_scores": {field: 0.0 for field in EVAL_FIELDS},
            "overall_score": 0,
            "issues": [str(exc)],
        }
        if args.output_json:
            print(json.dumps(result))
        else:
            print("ERROR: {}".format(exc), file=sys.stderr)
        sys.exit(0)
    result = run_evaluation(model_name=args.model_name, ollama_url=args.ollama_url, examples=examples)
    if args.output_json:
        print(json.dumps(result))
    else:
        print("Model: {}".format(result["model_name"]))
        print("Samples tested: {}".format(result["samples_tested"]))
        print("Response rate: {:.1%}".format(result["response_rate"]))
        print("Field accuracy: {:.1%}".format(result["field_accuracy"]))
        print("Overall score: {}/100".format(result["overall_score"]))
        for field, score in result["field_scores"].items():
            print("  {}: {:.1%}".format(field, score))
        if result["issues"]:
            print("Issues:")
            for issue in result["issues"]:
                print("  - {}".format(issue))


if __name__ == "__main__":
    main()
