/**
 * Drift guard: the frontend's mirror of `ANCHOR_TOLERANCE_KM`
 * (`frontend/src/shared/tour/anchorTolerance.ts`) has no compiler that
 * would catch it silently drifting from this file's value — the two are
 * on opposite sides of the frontend/backend language boundary, so
 * nothing but this test would notice. Same shape as
 * `backend/src/__tests__/dataIntegrity.airlineCatalog.test.ts`'s
 * generated-file guard: read the OTHER side's committed source as text
 * (never import it — a Jest/ts-node backend process cannot resolve a
 * Vite frontend module graph) and compare against this side's own live,
 * type-checked value.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { ANCHOR_TOLERANCE_KM } from '../anchorTolerance';

const FRONTEND_MIRROR_PATH = path.join(
  __dirname,
  '../../../../../frontend/src/shared/tour/anchorTolerance.ts',
);

function readFrontendValue(): number {
  let contents: string;
  try {
    contents = readFileSync(FRONTEND_MIRROR_PATH, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Frontend mirror not found at ${FRONTEND_MIRROR_PATH}. ` +
          'It must exist alongside backend/src/shared/tour/anchorTolerance.ts.',
      );
    }
    throw err;
  }

  const match = contents.match(/export const ANCHOR_TOLERANCE_KM\s*=\s*([0-9.]+)\s*;/);
  if (!match) {
    throw new Error(
      `Could not find "export const ANCHOR_TOLERANCE_KM = <number>;" in ${FRONTEND_MIRROR_PATH}. ` +
        'Has its export shape changed? Update this guard alongside it.',
    );
  }
  return Number(match[1]);
}

describe('shared/tour/anchorTolerance drift guard', () => {
  it('keeps the frontend mirror equal to the backend value', () => {
    expect(readFrontendValue()).toBe(ANCHOR_TOLERANCE_KM);
  });

  it('is a small, sane tolerance (regression: catches an accidental order-of-magnitude typo)', () => {
    expect(ANCHOR_TOLERANCE_KM).toBeGreaterThan(0);
    expect(ANCHOR_TOLERANCE_KM).toBeLessThan(100);
  });
});
