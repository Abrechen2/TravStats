# TravStats Parser Testing Framework

Comprehensive testing framework for Email and Boarding Pass parsers.

## 📁 Directory Structure

```
test-samples/
├── README.md                    # This file
├── emails/
│   ├── samples.json            # Email test metadata
│   ├── *.msg/*.eml/*.txt       # Email sample files
│   └── .gitkeep
├── boarding-passes/
│   ├── samples.json            # Boarding pass test metadata
│   ├── *.jpg/*.png             # Boarding pass images
│   └── .gitkeep
└── results/
    ├── email-test-*.json       # Test results
    ├── boardingpass-test-*.json
    └── .gitkeep
```

## 🚀 Quick Start

### 1. Add Sample Files

**Email Samples:**
1. Place `.msg`, `.eml`, or `.txt` files in `emails/`
2. Update `emails/samples.json` with expected data

**Boarding Pass Samples:**
1. Place boarding pass images (`.jpg`, `.png`) in `boarding-passes/`
2. Update `boarding-passes/samples.json` with expected data

### 2. Run Tests

```bash
# Run all tests
npm run test:samples

# Email parser only
npm run test:samples:email

# Boarding pass parser only
npm run test:samples:boardingpass
```

### 3. View Results

Test results are saved to `results/` as JSON files with:
- Accuracy metrics per sample
- Provider comparison (Ollama vs OpenAI vs Claude)
- Duration statistics
- Field-by-field comparison

## 📋 samples.json Format

### Email Samples (`emails/samples.json`)

```json
[
  {
    "filename": "lufthansa-roundtrip.msg",
    "path": "test-samples/emails/lufthansa-roundtrip.msg",
    "expected": [
      {
        "flightNumber": "LH2317",
        "departureCode": "LUX",
        "arrivalCode": "MUC",
        "departureTime": "2025-11-18T09:00",
        "arrivalTime": "2025-11-18T10:15",
        "pnr": "ABC123",
        "seat": "16F",
        "airline": "Lufthansa"
      },
      {
        "flightNumber": "LH2316",
        "departureCode": "MUC",
        "arrivalCode": "LUX",
        "departureTime": "2025-11-25T18:30",
        "arrivalTime": "2025-11-25T19:45",
        "pnr": "ABC123"
      }
    ],
    "notes": "Round-trip booking, should extract both flights with same PNR"
  }
]
```

### Boarding Pass Samples (`boarding-passes/samples.json`)

```json
[
  {
    "filename": "lufthansa-economy.jpg",
    "path": "test-samples/boarding-passes/lufthansa-economy.jpg",
    "expected": {
      "flightNumber": "LH103",
      "departureCode": "MUC",
      "arrivalCode": "FRA",
      "departureTime": "2025-11-18T10:30",
      "seat": "26F",
      "gate": "G32",
      "terminal": "2",
      "pnr": "ABC123",
      "boardingGroup": "3"
    },
    "notes": "Standard Lufthansa boarding pass"
  }
]
```

## 📊 Understanding Results

### Accuracy Calculation

- **Critical Fields (60% weight)**: flightNumber, departureCode, arrivalCode, departureTime
  - Each field: 15% (60% / 4 fields)
- **Optional Fields (40% weight)**: arrivalTime, pnr, seat, airline, terminal, gate, etc.
  - Weight distributed evenly among expected optional fields

### Accuracy Ratings

- **✅ Excellent (≥80%)**: Production-ready
- **⚠️ Good (50-79%)**: Acceptable, minor improvements needed
- **❌ Poor (<50%)**: Significant issues, needs investigation

### Performance Ratings

- **Excellent**: <3s per sample
- **Good**: 3-10s per sample
- **Slow**: >10s per sample

## 🔧 Adding New Samples

### Step 1: Collect Sample Data

**Email Samples:**
- Export booking confirmation emails as `.msg` (Outlook) or `.eml` (generic)
- OR save raw email text as `.txt` file
- Place in `emails/` directory

**Boarding Pass Samples:**
- Take photo or screenshot of boarding pass
- Ensure barcode and text are clearly visible
- Save as `.jpg` or `.png` in `boarding-passes/` directory

### Step 2: Extract Expected Data

Manually extract the expected flight data from the sample:

**Critical Fields (must extract):**
- `flightNumber`: e.g., "LH103", "FR8234"
- `departureCode`: 3-letter IATA code (e.g., "MUC")
- `arrivalCode`: 3-letter IATA code (e.g., "FRA")
- `departureTime`: ISO 8601 format (e.g., "2025-11-18T10:30")

**Optional Fields:**
- `arrivalTime`: ISO 8601 format
- `pnr`: Booking reference (usually 6 alphanumeric)
- `seat`: Seat number (e.g., "26F")
- `airline`: Full airline name
- `terminal`: Terminal number/letter
- `gate`: Gate number (e.g., "G32")
- `boardingGroup`: Boarding group/zone
- `price`, `currency`, `seatClass`, etc.

### Step 3: Update samples.json

Add entry to `emails/samples.json` or `boarding-passes/samples.json`:

```json
{
  "filename": "my-sample.msg",
  "path": "test-samples/emails/my-sample.msg",
  "expected": [ /* flight data */ ],
  "notes": "Description of what makes this sample unique"
}
```

### Step 4: Run Test

```bash
npm run test:samples:email    # or :boardingpass
```

## 📈 Test Report Example

```
📊 TEST REPORT
================================================================================

Type:             email
Timestamp:        2025-12-07T15:30:00.000Z
Total Samples:    5
Avg Accuracy:     92%
Avg Duration:     2350ms

📈 Provider Stats:
   ollama:
      Tested:   3
      Accuracy: 95%
      Duration: 2100ms
   regex:
      Tested:   2
      Accuracy: 87%
      Duration: 450ms

🎯 Accuracy Breakdown:
   ✅ Excellent (≥80%): 4
   ⚠️  Good (50-79%):   1
   ❌ Poor (<50%):      0

💡 RECOMMENDATIONS
================================================================================

   ✨ Excellent performance! Parser is production-ready.
   ⚡ Performance: Excellent (<3s per sample)
```

## 🎯 Best Practices

### Sample Collection

1. **Variety**: Include samples from different airlines, routes, and booking sources
2. **Edge Cases**: Include multi-leg flights, round-trips, name changes, etc.
3. **Real Data**: Use actual booking confirmations (anonymize sensitive data)
4. **Quality**: Ensure boarding pass images are clear and legible

### Expected Data Quality

1. **Accuracy**: Double-check all expected values
2. **Consistency**: Use ISO 8601 for dates, 3-letter IATA codes
3. **Completeness**: Include all visible fields from sample
4. **Notes**: Document special characteristics of each sample

### Testing Strategy

1. **Baseline**: Start with 5-10 simple samples
2. **Expand**: Add edge cases and difficult samples
3. **Regression**: Re-run tests after parser changes
4. **Comparison**: Test multiple parser providers side-by-side

## 🔍 Troubleshooting

### "No samples found"

- Check that `samples.json` exists in correct directory
- Verify file paths in `samples.json` match actual files

### Low accuracy scores

- Verify expected data is correct
- Check if sample file is readable (not corrupted)
- Review parser logs for specific errors
- Try different parser provider (Ollama vs OpenAI vs Claude)

### Slow performance

- Reduce sample size temporarily
- Check Ollama model size (smaller = faster)
- Ensure Ollama/API is responsive
- Consider using faster model for testing

### Provider not working

- Verify API keys in `.env` (for OpenAI/Claude)
- Check Ollama is running (`ollama serve`)
- Verify model is pulled (`ollama list`)

## 📝 Notes

- Sample files and results are **gitignored** to protect privacy
- Only `samples.json` structure is committed (with example data)
- Add `.gitkeep` files to preserve directory structure
- Real sample files should be stored locally only

## 🚀 Future Enhancements

- [ ] Automated sample collection from production logs
- [ ] Benchmark comparison between parser versions
- [ ] Visual diff for field mismatches
- [ ] Confidence scores for each extracted field
- [ ] Integration with CI/CD pipeline
