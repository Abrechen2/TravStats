import { readFileSync } from "fs";
import path from "path";

/**
 * The plan contract exists twice: here, and at `frontend/src/types/travplan.ts`
 * for the UI, which used to import this file across the tree boundary (and so
 * needed the Docker build to copy backend source into the frontend stage).
 * A copy nobody checks drifts, so the two are held equal here.
 */
const read = (file: string): string => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

it("keeps the frontend's copy of the plan contract identical to the backend's", () => {
  const backend = read(path.resolve(__dirname, "../types.ts"));
  const frontend = read(path.resolve(__dirname, "../../../../../frontend/src/types/travplan.ts"));
  expect(frontend).toBe(backend);
});
