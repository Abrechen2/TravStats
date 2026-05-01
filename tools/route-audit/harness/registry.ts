/**
 * Strategy registry — runner imports this to know which strategies to
 * exercise. Adding a strategy = adding one import + one entry here.
 */
import { baseline } from './strategies/baseline';
import { baselineCentripetal } from './strategies/baseline_centripetal';
import { baselineChaikin } from './strategies/baseline_chaikin';
import { baselinePrune } from './strategies/baseline_prune';
import { baselineResample } from './strategies/baseline_resample';
import { baselineResampleCentripetal } from './strategies/baseline_resample_centripetal';
import { baselineResampleCentripetalBuffered } from './strategies/baseline_resample_centripetal_buffered';
import { baselineResampleChaikin } from './strategies/baseline_resample_chaikin';
import { baselineResampleChaikinCentripetal } from './strategies/baseline_resample_chaikin_centripetal';
import { baselineResample30kmCentripetal } from './strategies/baseline_resample_30km_centripetal';
import { baselineResample100kmCentripetal } from './strategies/baseline_resample_100km_centripetal';
import { baselineResampleUniform } from './strategies/baseline_resample_uniform';
import { coarseChaikin } from './strategies/coarse_chaikin';
import { coarseOnly } from './strategies/coarse_only';
import { coarseResampleCentripetal } from './strategies/coarse_resample_centripetal';
import { coarseResampleChaikin } from './strategies/coarse_resample_chaikin';
import { direct } from './strategies/direct';
import { greatCircle } from './strategies/great_circle';
import type { Strategy } from './types';

export const strategies: ReadonlyArray<Strategy> = [
  baseline,
  baselineResample,
  baselineChaikin,
  baselineResampleChaikin,
  baselinePrune,
  baselineCentripetal,
  baselineResample30kmCentripetal,
  baselineResampleCentripetal,
  baselineResample100kmCentripetal,
  baselineResampleCentripetalBuffered,
  baselineResampleChaikinCentripetal,
  baselineResampleUniform,
  coarseOnly,
  coarseChaikin,
  coarseResampleChaikin,
  coarseResampleCentripetal,
  direct,
  greatCircle,
];
