/**
 * A file's bytes as plain base64 (no `data:` prefix) — what `/parse-pdf`
 * takes. One home for every upload that sends a PDF, so the import drop zone
 * and the place document tile cannot encode it two ways.
 */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(reader.error ?? new Error("file could not be read"));
    reader.onload = (): void => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** A PDF by its type or, when the browser gives none, by its name. */
export const isPdfFile = (file: File): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);
