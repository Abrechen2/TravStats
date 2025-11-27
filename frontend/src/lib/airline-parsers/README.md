# Airline-Specific Boarding Pass Parsers

## Architecture: One Scanner, Multiple Parsers

Instead of creating separate scanners for each airline, we use a **Fallback Chain Pattern**:

```
BoardingPassScanner (ONE component)
          ↓
    Barcode detected
          ↓
parseBCBP() (Fallback Chain)
    1. parseBCBPStandard()          → Standard IATA format
    2. parseRyanairBoardingPass()   → Ryanair-specific
    3. parseEasyJetBoardingPass()   → easyJet-specific
    4. parseURLBoardingPass()       → URL-based (web BP)
    5. parseFallbackBoardingPass()  → RegEx-based (catches everything)
          ↓
    Structured data (BoardingPassData)
```

## Why This Approach?

### ✅ Advantages
- **DRY:** No code duplication (scanner UI, camera, barcode detection)
- **Easy to maintain:** Bug fixes apply to all airlines automatically
- **Better UX:** User just scans, system detects format automatically
- **Extensible:** Adding new airline = one new file
- **Fallback safety:** If airline parser fails, generic parser catches it

### ❌ Alternative (Bad)
Creating separate scanners per airline:
- ❌ Code duplication (80% identical code)
- ❌ Hard to maintain (bug fix × 10 files)
- ❌ Bad UX (user must select airline first)
- ❌ Inflexible (what if format changes?)

## Adding a New Airline Parser

### 1. Create Parser File

```typescript
// frontend/src/lib/airline-parsers/myAirlineParser.ts

import { BoardingPassData } from '../bcbpParser';

export function parseMyAirlineBoardingPass(barcodeData: string): BoardingPassData | null {
  try {
    // 1. Check if it's likely this airline
    if (!barcodeData.includes('MY_AIRLINE_INDICATOR')) {
      return null;
    }

    // 2. Extract data using airline-specific patterns
    const extracted: Partial<BoardingPassData> = {
      raw: barcodeData,
      formatCode: 'MY_AIRLINE',
      // ... other fields
    };

    // 3. Use regex to extract fields
    const flightPattern = /FLIGHT:\s*([A-Z]{2}\d{4})/;
    const match = barcodeData.match(flightPattern);
    // ...

    // 4. Validate (minimum: airports required)
    if (!extracted.departureAirport || !extracted.arrivalAirport) {
      return null;
    }

    return extracted as BoardingPassData;
  } catch (error) {
    console.error('❌ MyAirline parsing error:', error);
    return null;
  }
}
```

### 2. Add to Parser Chain

```typescript
// frontend/src/lib/bcbpParser.ts

import { parseMyAirlineBoardingPass } from './airline-parsers/myAirlineParser';

export function parseBCBP(barcodeData: string): BoardingPassData | null {
  // Try 1: Standard IATA BCBP
  const bcbpResult = parseBCBPStandard(barcodeData);
  if (bcbpResult) return bcbpResult;

  // Try 2: Airline-specific
  const myAirlineResult = parseMyAirlineBoardingPass(barcodeData);
  if (myAirlineResult) return myAirlineResult;

  // ... rest of chain
}
```

### 3. Test with Debug Mode

1. Open app at `http://localhost:3001`
2. Click "Add Flight" → "Scan Now"
3. Upload boarding pass image
4. Click "Show Raw Data" to see what was scanned
5. Check console logs for parsing steps

## Available Parsers

### ✅ Implemented
- **Standard IATA BCBP** (`parseBCBPStandard`) - Works for most airlines
- **Ryanair** (`parseRyanairBoardingPass`) - Proprietary QR format
- **Intelligent Fallback** (`parseFallbackBoardingPass`) - RegEx-based, catches most formats

### 🚧 Planned (See ROADMAP.md)
- easyJet
- Wizz Air
- Lufthansa proprietary
- British Airways
- Eurowings
- Turkish Airlines
- Emirates
- Qatar Airways

## Common Patterns by Airline

### Ryanair
- **Format:** Proprietary QR code
- **Indicators:** Contains "RYANAIR" or "FR"
- **Flight Number:** `FR####` (4 digits)
- **Route:** `XXX-YYY` or `XXX to YYY`
- **Seat:** `SEAT: ##A`
- **PNR:** 6-character alphanumeric

### easyJet (TODO)
- **Format:** Usually IATA BCBP standard
- **Airline Code:** `U2` or `EC`
- **Fallback:** Often works with standard parser

### Lufthansa (TODO)
- **Format:** Aztec code (non-BCBP)
- **Indicators:** "LUFTHANSA", "LH"
- **Pattern:** Structured text with labeled fields

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

import { parseRyanairBoardingPass } from '../ryanairParser';

describe('Ryanair Parser', () => {
  it('should parse valid Ryanair boarding pass', () => {
    const mockData = 'RYANAIR FR1234 DUB-STN SEAT: 12A ...';
    const result = parseRyanairBoardingPass(mockData);

    expect(result).not.toBeNull();
    expect(result?.flightNumber).toBe('1234');
    expect(result?.departureAirport).toBe('DUB');
    expect(result?.arrivalAirport).toBe('STN');
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

**Last Updated:** 2025-11-27
**Maintainer:** TravStats Development Team
