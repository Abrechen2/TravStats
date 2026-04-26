import { promises as fs } from "fs";
import { extractTextFromPdf } from "../src/services/pdfParser";

async function main(): Promise<void> {
  const buffer = await fs.readFile(process.argv[2]);
  const text = await extractTextFromPdf(buffer);
  console.log(`=== ${text.length} chars ===`);
  console.log(text);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
