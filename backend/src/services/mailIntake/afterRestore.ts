/**
 * After a database restore (spec §9, decision 4): IMAP passwords are not part
 * of a backup the user gets back. Every source loses its stored password and
 * switches off, with the reason `credentials_missing` on the card, so the owner
 * enters the password again instead of a poller retrying a login that may no
 * longer be valid.
 */
import { prisma } from "../../db";

export async function scrubMailCredentialsAfterRestore(): Promise<number> {
  const { count } = await prisma.mailIntakeSource.updateMany({
    data: {
      passwordEncrypted: null,
      enabled: false,
      lastError: "credentials_missing",
      lastErrorAt: new Date(),
    },
  });
  return count;
}
