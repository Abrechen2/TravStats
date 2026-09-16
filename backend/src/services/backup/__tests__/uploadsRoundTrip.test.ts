import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { archiveUploads } from "../backupFiles";
import { extractUploadsArchive } from "../backupRestore";
import { BACKED_UP_UPLOAD_DIRS } from "../../../config/uploadDirs";

/**
 * A restored receipt has to be where its database row says it is.
 *
 * The archive stores `uploads/<dir>/…` and the restore used to unpack into the
 * uploads directory itself, so everything landed one level too deep —
 * `uploads/uploads/receipts/…`. The restore reported success, the files were
 * genuinely there, and not one of them was reachable under the filename the
 * database had kept (audit finding AUD-006).
 *
 * The existing test for this area reads the tarball's ENTRIES, which were
 * correct the whole time. Only putting the two halves back together shows the
 * defect, so this test archives for real and extracts for real, and then looks
 * for the file at the path the application would ask for.
 */
const MARKER_DIR = BACKED_UP_UPLOAD_DIRS[0];
const MARKER_NAME = `roundtrip-marker-${process.pid}.txt`;
const MARKER_BODY = "round trip";

const realUploadsDir = path.join(__dirname, "../../../../uploads");
const markerPath = path.join(realUploadsDir, MARKER_DIR, MARKER_NAME);

// GNU tar on Windows reads an absolute path as `host:path` and tries to resolve
// "C:" as a machine — a quirk of the developer platform, not of the code, which
// runs in a Linux container. Skipping keeps the guard honest where it applies
// (CI runs on ubuntu) instead of adding a --force-local flag that busybox tar in
// the production image would not understand.
const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("uploads survive a backup and a restore", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-uploads-roundtrip-"));
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, MARKER_BODY);
  });

  afterAll(() => {
    fs.rmSync(markerPath, { force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("puts a restored file back where the database expects it", async () => {
    const archivePath = path.join(workDir, "uploads.tar.gz");
    await archiveUploads(archivePath);
    expect(fs.existsSync(archivePath)).toBe(true);

    // A fresh, empty uploads directory — the disaster-recovery case.
    const restoredUploads = path.join(workDir, "restored", "uploads");
    await extractUploadsArchive(archivePath, restoredUploads);

    // This is the path the app builds from a stored filename.
    const expected = path.join(restoredUploads, MARKER_DIR, MARKER_NAME);
    expect(fs.readFileSync(expected, "utf8")).toBe(MARKER_BODY);

    // And the shape the bug produced must not be there.
    const doubled = path.join(restoredUploads, "uploads", MARKER_DIR, MARKER_NAME);
    expect(fs.existsSync(doubled)).toBe(false);
  });
});
