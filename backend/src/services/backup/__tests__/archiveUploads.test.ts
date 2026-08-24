import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { archiveUploads } from '../backupFiles';
import { BACKED_UP_UPLOAD_DIRS, UPLOADS_ROOT } from '../../../config/uploadDirs';

/**
 * The registry test proves the LIST is complete. This proves the list is
 * actually USED — a correct constant wired to nothing would have shipped the
 * same broken backup.
 *
 * Drops one marker file into every registered upload directory, archives, and
 * requires every marker back out of the tarball. `trip-photos` and
 * `place-photos` are the two that were silently missing.
 */
describe('archiveUploads', () => {
  const markers: string[] = [];
  let archivePath: string;

  beforeAll(() => {
    for (const dir of BACKED_UP_UPLOAD_DIRS) {
      const full = path.join(UPLOADS_ROOT, dir);
      fs.mkdirSync(full, { recursive: true });
      const marker = path.join(full, `.backup-test-marker-${dir}`);
      fs.writeFileSync(marker, 'marker');
      markers.push(marker);
    }
    archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-backup-')), 'uploads.tar.gz');
  });

  afterAll(() => {
    for (const m of markers) {
      try {
        fs.unlinkSync(m);
      } catch {
        // Harmless: the directory may not have existed before this test.
      }
    }
  });

  it('archives every registered upload directory', async () => {
    await archiveUploads(archivePath);
    expect(fs.existsSync(archivePath)).toBe(true);

    // The archive name is passed RELATIVE with `cwd` set to its directory.
    // An absolute Windows path ("C:\...") makes GNU tar read the drive letter
    // as a remote host and fail with "Cannot connect to C". Keeping the colon
    // out of the argument works on every platform without a tar-specific flag.
    const listing = execFileSync('tar', ['-tzf', path.basename(archivePath)], {
      cwd: path.dirname(archivePath),
      encoding: 'utf8',
    });

    for (const dir of BACKED_UP_UPLOAD_DIRS) {
      expect(listing).toContain(`uploads/${dir}/.backup-test-marker-${dir}`);
    }
  });
});
