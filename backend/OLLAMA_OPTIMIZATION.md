# Ollama Model Optimization for TravStats

## Recommended Model: gemma3:12b

Based on benchmarking against 23 real Lufthansa/SWISS/Air Dolomiti booking
emails (5 with ground-truth expected data, 12 individual flight legs):

| Model | Accuracy | JSON Errors | Avg Time/Email | Tokens/s | VRAM |
|-------|----------|-------------|----------------|----------|------|
| **gemma3:12b** | **100%** (12/12 perfect) | **0/23** | **~24s** | 26 t/s | 7.6 GB |
| gemma4:latest | 86% (4/12 perfect) | 0/23 | ~50s | 54 t/s | 8.9 GB |
| qwen3:30b-a3b | 100% when parseable | **8+/23** timeouts+JSON | ~44s | 52 t/s | 17.3 GB |

### Why gemma3:12b wins

- **Perfect extraction**: flight numbers, IATA codes, times, PNRs, seats
  all matched expected data on every test email.
- **Reliable JSON output**: zero parse failures across 23 emails. qwen3
  frequently emits `<think>` blocks and explanatory text despite
  `think: false` + `/no_think`, breaking JSON extraction.
- **Fast**: ~24s per email — nearly 2x faster than qwen3 despite lower
  tokens/s, because it produces concise responses without reasoning overhead.
- **Low VRAM**: 7.6 GB vs 17.3 GB for qwen3 — leaves headroom for other
  models or services on the same GPU.

### Known weaknesses by model

- **gemma4:latest** systematically misses seat assignments and confuses
  departure/arrival times on multi-leg bookings (LX1101 ZRH route).
- **qwen3:30b-a3b** emits reasoning tokens even with `think: false`,
  causing JSON parse failures on >35% of emails. Timeout at 300s on
  complex multi-stop bookings.

## Configuration

```bash
# .env / docker-compose
OLLAMA_MODEL=gemma3:12b
```

Fallback default in code: `ollamaTextParser.ts` constructor defaults to
`gemma3:12b` when `OLLAMA_MODEL` is not set.

## Benchmarking

Run the benchmark script against the sample emails:

```bash
# Test all models
node scripts/parse-samples.mjs

# Test a specific model
node scripts/parse-samples.mjs --model gemma3:12b

# Test against ALL .msg files (not just samples.json)
node scripts/parse-samples.mjs --all
```

Expected data lives in `test-samples/emails/samples.json`. Add new entries
there when adding test emails.

## Alternative Models

For resource-constrained environments:

| Use Case | Model | VRAM | Notes |
|----------|-------|------|-------|
| Production | gemma3:12b | 7.6 GB | Recommended |
| Low-memory | qwen2.5:7b | 4.7 GB | Good accuracy, less reliable on multi-leg |
| Minimal | llama3.2:3b | 1.5 GB | Fast, lower accuracy on complex bookings |

## Parser Architecture

1. User-derived regex templates (highest priority)
2. Ollama LLM parser (when configured, tries before built-in templates)
3. HTML-selector template parser
4. Regex fallback chain

The system prompt instructs the model to return a flat JSON array of flight
objects. The parser cleans `<think>` blocks and markdown fences before
extracting JSON. Post-processing enriches results with regex-extracted
PNR, gate, terminal, and operating airline data.

---

*Last benchmarked: 2026-04-12 on Mac Mini M4 (Ollama server on LAN)*
