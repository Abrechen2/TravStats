/**
 * Validate a PhotoPrism connection: bad URL vs wrong software vs too-old build
 * vs bad app password vs missing `config` scope vs unreachable, each its own
 * fixed failure kind. Mirrors `immich/immichTester.ts`.
 */
import { createPhotoSource } from "../photoSource";
import type { PhotoSourceTestResult } from "../photoSource/types";
import type { TargetPolicy } from "../egress/privateTargets";
import { ImmichError, normalizeImmichBaseUrl } from "../immich/types";

export async function testPhotoprismConnection(
  baseUrl: string,
  token: string,
  policy: TargetPolicy
): Promise<PhotoSourceTestResult> {
  let normalized: string;
  try {
    normalized = normalizeImmichBaseUrl(baseUrl, policy, "PhotoPrism");
  } catch (error) {
    return {
      success: false,
      kind: error instanceof ImmichError ? error.kind : "invalidUrl",
      ...(error instanceof ImmichError && error.code ? { code: error.code } : {}),
      message: error instanceof ImmichError ? error.message : "Invalid PhotoPrism URL",
    };
  }
  return createPhotoSource("photoprism", {
    baseUrl: normalized,
    apiKey: token,
    source: "user",
    allowPrivate: policy.allowPrivate,
  }).test();
}
