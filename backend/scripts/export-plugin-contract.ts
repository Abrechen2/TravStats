/**
 * Writes the suggestion plugin contract (JSON Schema, from the server's OpenAPI
 * components) into the template package:
 *
 *   npx tsx scripts/export-plugin-contract.ts
 *
 * `services/plugins/__tests__/contractSchema.test.ts` fails while the file and
 * the server disagree.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { pluginContractSchema, serialiseContract } from "../src/services/plugins/contractSchema";

const target = join(__dirname, "../../packages/travstats-plugin-template/contract/v1.schema.json");
writeFileSync(target, serialiseContract(pluginContractSchema()));
console.log(`wrote ${target}`);
