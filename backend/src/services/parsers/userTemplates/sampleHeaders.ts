/**
 * Who sent a workshop sample, and what the message was called.
 *
 * One home for the two readings, because there were three copies and they
 * disagreed: `deriver.ts` took only the sender's DOMAIN and accepted any
 * `@` shape, `routes/parserTemplates.ts` took the whole ADDRESS with a
 * stricter one, and neither knew about the columns the upload route now
 * fills. Two copies of a counting rule is how `continents.ts` drifted
 * (CLAUDE.md, "a counting rule has exactly one home").
 *
 * These read a header block out of TEXT. They are the FALLBACK: a sample
 * uploaded since 2026-09-19 carries `TrainingData.senderAddress` and
 * `.subject`, read from the real headers before anything stripped them. The
 * fallback still matters for rows written before that, for a `.msg` whose
 * header is unreadable, and for text pasted with its headers still on.
 */

/** `From: Hotel Seeblick <res@hotel.test>` and `From: res@hotel.test`. */
const FROM_LINE = /^From:\s*(?:[^<\r\n]*<)?\s*([^\s<>@]+@[^\s<>]+?)\s*>?\s*$/im;
const SUBJECT_LINE = /^Subject:\s*(.+)$/im;

/** The sender's address as the text states it, or null. */
export function senderAddressIn(text: string): string | null {
  const match = FROM_LINE.exec(text);
  return match ? match[1].trim() : null;
}

/** The subject line as the text states it, or null. */
export function subjectIn(text: string): string | null {
  const match = SUBJECT_LINE.exec(text);
  const subject = match ? match[1].trim() : "";
  return subject.length > 0 ? subject : null;
}

/**
 * The domain part of an address, lower-cased — the half a template anchors on.
 *
 * The local part names a MAILBOX and often the booking system's noreply alias;
 * the domain names the sender, which is what a fingerprint is a statement
 * about.
 */
export function senderDomainOf(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return undefined;
  return (
    address
      .slice(at + 1)
      .trim()
      .toLowerCase() || undefined
  );
}
