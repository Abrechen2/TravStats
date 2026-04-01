import { extractTextFromPdf, isBcbpText } from '../pdfParser';

// pdf-parse v2 relies on pdfjs-dist ESM workers which require --experimental-vm-modules
// in Jest's CJS/ts-jest environment. The valid-PDF path is tested via integration test.
// Here we only unit-test the guard logic that runs before pdf-parse is invoked.
describe('pdfParser', () => {
  it('rejects non-PDF buffers (no magic header)', async () => {
    const notPdf = Buffer.from('hello world');
    await expect(extractTextFromPdf(notPdf)).rejects.toThrow('Invalid PDF');
  });

  it('rejects empty buffer', async () => {
    await expect(extractTextFromPdf(Buffer.alloc(0))).rejects.toThrow('Invalid PDF');
  });

  it('rejects buffer shorter than 4 bytes', async () => {
    await expect(extractTextFromPdf(Buffer.from([0x25, 0x50, 0x44]))).rejects.toThrow('Invalid PDF');
  });

  describe('isBcbpText', () => {
    it('returns true for M1 BCBP prefix', () => {
      expect(isBcbpText('M1SMITH/JOHN       EABC123 TXLCDGLH 123 001Y002A0001 100')).toBe(true);
    });

    it('returns true for M2 BCBP prefix', () => {
      expect(isBcbpText('M2DOE/JANE         EXYZ789 FRAMUCLH 456 002Y003B0002 100')).toBe(true);
    });

    it('returns false for non-BCBP text', () => {
      expect(isBcbpText('Hello, this is not a boarding pass')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isBcbpText('')).toBe(false);
    });

    it('trims whitespace before checking', () => {
      expect(isBcbpText('  M1SMITH/JOHN')).toBe(true);
    });
  });
});
