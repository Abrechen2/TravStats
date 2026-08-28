import * as fs from 'fs';
import * as path from 'path';
import { BACKED_UP_UPLOAD_DIRS } from '../uploadDirs';

/**
 * The guard that would have caught the original defect: three of six upload
 * directories were missing from the backup, and nothing measured the gap.
 *
 * This walks the backend source for `uploads/<name>` directory constants and
 * requires each one to be listed for backup. Adding a new upload directory
 * without adding it here fails here, not in someone's restore.
 */
function collectUploadDirNamesFromSource(): Set<string> {
  const root = path.join(__dirname, '../..');
  const found = new Set<string>();
  // Only the constant form — `path.join(__dirname, '../../uploads/<name>')`,
  // anchored on the `../../` prefix that form always carries.
  //
  // A route path is not a directory and must not be mistaken for one. That
  // holds whether it sits in a comment ("POST /api/v1/uploads/receipt") or in
  // a string, as the OpenAPI endpoint inventory lists it: "POST
  // /uploads/receipt" names an endpoint, while the directory behind it is
  // `receipts`. Matching any string that merely ends in `/uploads/<name>`
  // demanded a backup entry for a directory that does not exist.
  const pattern = /['"]\.\.\/\.\.\/uploads\/([a-z0-9-]+)['"]/g;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(text)) !== null) found.add(m[1]);
      }
    }
  };
  walk(root);
  return found;
}

describe('upload directories', () => {
  it('backs up every upload directory the source defines', () => {
    const inSource = collectUploadDirNamesFromSource();
    // Sanity: the scan must actually find something, or this test passes for
    // the wrong reason forever.
    expect(inSource.size).toBeGreaterThanOrEqual(5);

    const missing = [...inSource].filter((d) => !BACKED_UP_UPLOAD_DIRS.includes(d));
    expect(missing).toEqual([]);
  });

  it('lists no directory twice', () => {
    expect(new Set(BACKED_UP_UPLOAD_DIRS).size).toBe(BACKED_UP_UPLOAD_DIRS.length);
  });
});
