import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { writeFinalArchive } from "../backupFiles";

/**
 * forgejo#356: the archive's file stream had no 'error' listener, so ENOSPC
 * during a scheduled backup was an uncaught exception that exited the server.
 * The write error must reject, so the backup is marked failed instead.
 */
describe("the final backup archive", () => {
  // /dev/full answers every write with ENOSPC, the real failure, no mock needed.
  const itOnLinux = fs.existsSync("/dev/full") ? it : it.skip;
  itOnLinux(
    "rejects when the output file cannot be written (ENOSPC) instead of throwing uncaught",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-enospc-"));
      const sql = path.join(dir, "database.sql");
      fs.writeFileSync(sql, "select 1;");
      try {
        await expect(writeFinalArchive("/dev/full", sql, sql, {})).rejects.toThrow(/ENOSPC/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
