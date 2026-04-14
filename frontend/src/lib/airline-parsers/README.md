# Hybrid Boarding Pass Parser System

## Architecture: Hybrid Approach with Registry Pattern

The boarding pass parsing system uses a **hybrid approach** combining fast frontend barcode parsing with robust backend LLM/API parsing:

```
BoardingPassScanner (ONE component)
          ↓
    Image uploaded
          ↓
[1] Provider Availability Check
    → LLM (Ollama) available? → Use LLM directly (fastest, best quality)
    → Else: Check user strategy
          ↓
[2] Barcode Extraction (if strategy allows)
    → Extract QR/Aztec/PDF417 barcode from image
          ↓
[3] Frontend Parser (Registry Pattern)
    → Standard BCBP Parser (Priority 10) - IATA standard format
    → URL Parser (Priority 20) - URL-based boarding passes
    → Fallback Parser (Priority 100) - RegEx-based catch-all
          ↓
[4] Backend LLM/API (Fallback or Validation)
    → Ollama Vision / OpenAI / Claude for image analysis
    → Used if: parser failed, strategy is "api-only", or strategy is "parser-with-api" (validation)
          ↓
    Structured data (BoardingPassData / ParsedBooking)
```

## Registry Pattern

Instead of a manual fallback chain, parsers are registered in a **ParserRegistry**:

```typescript
// Parser Interface
interface BoardingPassParser {
  name: string;
  priority: number;
  canParse(barcodeData: string): boolean;
  parse(barcodeData: string): BoardingPassData | null;
}

// Auto-registration in index.ts
registry.register(new StandardBCBPParser());
registry.register(new URLParser());
registry.register(new FallbackParser());
```

## Why This Hybrid Approach?

### ✅ Advantages

- **⚡ Performance:** Barcode parsing <10ms (vs. LLM 2-5s)
- **💰 Cost:** Barcode parsing is free (client-side) vs. API costs
- **🌐 Offline:** Works without internet connection
- **🎯 Accuracy:** LLM handles edge cases and all airline formats
- **🔧 Maintainable:** Only 3 frontend parsers to maintain (vs. 100+ airline-specific)
- **📈 Scalable:** Registry pattern allows easy addition of new parsers

### 📊 Strategy Selection

Users can choose parsing strategy via settings:

1. **Auto (null)** - Default
   - LLM if available → Use LLM directly
   - Else → Try barcode extraction → Frontend parser → LLM fallback

2. **Parser Only** - `"parser-only"`
   - Barcode extraction → Frontend parser
   - No LLM/API fallback
   - Fastest, completely offline

3. **Parser + API** - `"parser-with-api"`
   - Barcode extraction → Frontend parser (fast)
   - LLM/API validation (improves accuracy)
   - Best balance of speed and quality

4. **API Only** - `"api-only"`
   - Direct LLM/API parsing
   - No barcode extraction attempt
   - Most robust, handles all formats

## Adding a New Parser

### 1. Create Parser Class

```typescript
// frontend/src/lib/airline-parsers/myCustomParser.ts

import { BoardingPassParser } from "./IParser";
import { BoardingPassData } from "../bcbpParser";
import { logger } from "../logger";

export class MyCustomParser implements BoardingPassParser {
  name = "my-custom";
  priority = 30; // Between Standard BCBP (10) and URL (20) or after URL
  category: "core" = "core";

  canParse(barcodeData: string): boolean {
    // Quick check - should be fast
    return barcodeData.includes("MY_CUSTOM_INDICATOR");
  }

  parse(barcodeData: string): BoardingPassData | null {
    try {
      // Parse logic here
      const extracted: Partial<BoardingPassData> = {
        raw: barcodeData,
        formatCode: "MY_CUSTOM",
        // ... extract fields
      };

      // Validate
      if (!extracted.departureAirport || !extracted.arrivalAirport) {
        return null;
      }

      return extracted as BoardingPassData;
    } catch (error) {
      logger.error("[MyCustom Parser] Error:", error);
      return null;
    }
  }
}
```

### 2. Register Parser

```typescript
// frontend/src/lib/airline-parsers/index.ts

import { MyCustomParser } from "./myCustomParser";

const registry = ParserRegistry.getInstance();

registry.register(new StandardBCBPParser());
registry.register(new URLParser());
registry.register(new MyCustomParser()); // Add here
registry.register(new FallbackParser()); // Always last
```

### 3. Test with Debug Mode

1. Open app at `http://localhost:3001`
2. Click "Add Flight" → "Scan Now"
3. Upload boarding pass image
4. Click "Show Raw Data" to see what was scanned
5. Check console logs for parsing steps

## Available Parsers

### ✅ Implemented (Frontend Parsers)

- **Standard IATA BCBP** (`StandardBCBPParser`) - Priority 10
  - Works for ~80% of all airlines worldwide
  - Parses IATA BCBP standard format
- **URL Parser** (`URLParser`) - Priority 20
  - Handles URL-based boarding passes (web boarding passes)
  - Currently detects URLs, full parsing requires backend integration
- **Fallback Parser** (`FallbackParser`) - Priority 100
  - RegEx-based intelligent parser
  - Extracts flight data from any text format
  - Always runs last as catch-all

### 🔄 Backend Parsers (LLM/API)

- **Ollama Vision** - Preferred (free, local, fast)
- **OpenAI Vision** - Fallback if Ollama unavailable
- **Claude Vision** - Alternative fallback

### Note on Airline-Specific Parsers

Airline-specific parsers (Ryanair, easyJet, etc.) have been **removed** because:

- Standard BCBP parser covers most airlines
- LLM can handle all airline-specific formats robustly
- Reduces code complexity and maintenance burden
- Fewer bugs and easier to test

## Common Patterns by Airline

> Reference documentation only. Airline-specific BCBP parsers were
> intentionally removed — see the "Available Parsers" section above.
> The Standard BCBP parser plus LLM fallback covers all of the
> formats below.

### Ryanair

- **Format:** Proprietary QR code
- **Indicators:** Contains "RYANAIR" or "FR"
- **Flight Number:** `FR####` (4 digits)
- **Route:** `XXX-YYY` or `XXX to YYY`
- **Seat:** `SEAT: ##A`
- **PNR:** 6-character alphanumeric

### easyJet

- **Format:** Usually IATA BCBP standard
- **Airline Code:** `U2` or `EC`
- **Handled by:** Standard BCBP parser

### Lufthansa

- **Format:** Aztec code (non-BCBP)
- **Indicators:** "LUFTHANSA", "LH"
- **Handled by:** LLM fallback (Ollama Vision / OpenAI / Claude)

### Low-Cost vs. Legacy Carriers

**Low-Cost (Ryanair, easyJet, Wizz Air):**

- Often use proprietary QR codes
- Simpler structure (fewer fields)
- May omit some IATA fields

**Legacy Carriers (Lufthansa, BA, Emirates):**

- Usually follow IATA BCBP standard
- May have additional proprietary fields
- Better structured data

## Testing Strategy

### 1. Unit Tests

```typescript
// frontend/src/lib/airline-parsers/__tests__/ryanairParser.test.ts

import { parseRyanairBoardingPass } from "../ryanairParser";

describe("Ryanair Parser", () => {
  it("should parse valid Ryanair boarding pass", () => {
    const mockData = "RYANAIR FR1234 DUB-STN SEAT: 12A ...";
    const result = parseRyanairBoardingPass(mockData);

    expect(result).not.toBeNull();
    expect(result?.flightNumber).toBe("1234");
    expect(result?.departureAirport).toBe("DUB");
    expect(result?.arrivalAirport).toBe("STN");
  });
});
```

### 2. Integration Tests

- Test full scan → parse → form-fill flow
- Test fallback chain (standard fails → Ryanair succeeds)
- Test unknown format → fallback parser

### 3. Manual Testing

- Use real boarding pass images
- Test with debug mode enabled
- Verify console logs show parsing steps

## Debugging Tips

### Enable Debug Mode

1. Scan boarding pass
2. Click "Show Raw Data"
3. Check:
   - **Length:** How many characters?
   - **First 10 chars:** What's the prefix?
   - **Format:** IATA BCBP / URL / Unknown

### Console Logs

```
🔍 Attempting fallback parsing on: [raw text]
✓ Airports found: LUX → MUC
✓ Flight found: LH2317
✓ Date found: 20NOV25 → 2025-11-20
✓ Seat found: 16F
✓ Class found: ECONOMY
✅ Fallback parsing successful!
```

### Common Issues

- **No barcode found:** Check image quality, lighting
- **Barcode found but not recognized:** Check if format is in parser chain
- **Wrong data extracted:** Regex pattern may need adjustment
- **Airports missing:** Fallback parser will fail, needs debugging

## Contributing

To add support for a new airline:

1. **Research:** Get sample boarding pass (photo or text)
2. **Analyze:** Identify patterns (flight number, airports, date, etc.)
3. **Create Parser:** Copy `ryanairParser.ts` as template
4. **Add to Chain:** Import in `bcbpParser.ts`
5. **Test:** Use debug mode + console logs
6. **Document:** Update this README

## Related Files

- [`BoardingPassScanner.tsx`](../../components/BoardingPassScanner.tsx) - Scanner UI component
- [`bcbpParser.ts`](../bcbpParser.ts) - Main parser with fallback chain
- [`SimplifiedFlightFormV2.tsx`](../../components/SimplifiedFlightFormV2.tsx) - Form integration
- [`test-bcbp-parser.html`](../../test-bcbp-parser.html) - Standalone testing page

---

## File Structure

```
frontend/src/lib/
├── barcodeExtractor.ts          # Barcode extraction from images
├── bcbpParser.ts                # Main parser (uses registry)
│
└── airline-parsers/
    ├── IParser.ts               # Parser interface
    ├── parserRegistry.ts        # Registry singleton
    ├── index.ts                 # Auto-registration
    │
    ├── standardBCBPParser.ts    # Standard IATA BCBP (Priority 10)
    ├── urlParser.ts             # URL-based (Priority 20)
    └── fallbackParser.ts        # RegEx fallback (Priority 100)
```

## Related Files

- [`BoardingPassScanner.tsx`](../../components/BoardingPassScanner.tsx) - Scanner UI with hybrid flow
- [`bcbpParser.ts`](../bcbpParser.ts) - Main parser entry point
- [`barcodeExtractor.ts`](../barcodeExtractor.ts) - Barcode extraction service
- [`settingsStore.ts`](../../store/settingsStore.ts) - User strategy settings

---

**Last Updated:** 2025-01-XX
**Maintainer:** TravStats Development Team
**Architecture:** Hybrid Parser System (Registry Pattern + LLM Fallback)
