import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "../../lib/apiError";
import { saveErrorKey } from "../../lib/saveErrorMessage";

/** The types the server's photo filter accepts (`middleware/upload.ts`). */
export const NOTE_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

/** 15 MB, the server's photo limit (`FILE_LIMITS.TRIP_PHOTO_MAX_SIZE`). */
export const NOTE_PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Refused before the request, with the sentence the server's refusal would
 * get: a type the filter would turn away or a file over the limit. Null when
 * the file may be sent. An empty `type` (some browsers for HEIC) is left to
 * the server rather than refused on a guess.
 */
export function localPhotoProblem(file: File): string | null {
  if (file.size > NOTE_PHOTO_MAX_BYTES) return "notes:errors.photoTooLargeLocal";
  const type = file.type.toLowerCase();
  if (type !== "" && !(NOTE_PHOTO_TYPES as readonly string[]).includes(type)) {
    return "notes:errors.photoTypeLocal";
  }
  return null;
}

/**
 * The sentence for a photo upload that failed AFTER the note itself was saved
 * — every one of them says so, because the user must not think the note is
 * gone with the photo.
 */
export function photoErrorKey(err: unknown): string {
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "common:saveErrors.demo";
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 413) return "notes:errors.photoTooLarge";
  if (apiErrorMachineCode(err) === "PHOTO_UNREADABLE") return "notes:errors.photoUnreadable";
  if (status === 400) return "notes:errors.photoType";
  return saveErrorKey(err, "notes:errors.photoFailed");
}
