import { BACKED_UP_UPLOAD_DIRS } from "../uploadDirs";
import { collectUploadDirNamesFromSource } from "./uploadDirScan";

/**
 * The guard that would have caught the original defect: three of six upload
 * directories were missing from the backup, and nothing measured the gap.
 *
 * This walks the backend source for `uploads/<name>` directory constants and
 * requires each one to be listed for backup. Adding a new upload directory
 * without adding it here fails here, not in someone's restore.
 */
describe("upload directories", () => {
  it("backs up every upload directory the source defines", () => {
    const inSource = collectUploadDirNamesFromSource();
    // Sanity: the scan must actually find something, or this test passes for
    // the wrong reason forever.
    expect(inSource.size).toBeGreaterThanOrEqual(5);

    const listed: readonly string[] = BACKED_UP_UPLOAD_DIRS;
    const missing = [...inSource].filter((d) => !listed.includes(d));
    expect(missing).toEqual([]);
  });

  it("lists no directory twice", () => {
    expect(new Set(BACKED_UP_UPLOAD_DIRS).size).toBe(BACKED_UP_UPLOAD_DIRS.length);
  });
});
