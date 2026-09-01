/**
 * The body of POST /api/v1/parse-email.
 *
 * It lives here rather than in the route because the OpenAPI document
 * describes it too, and the two used to be separate hand-written copies: the
 * published schema listed only `emailContent` and `subject`, so `domain` was
 * undocumented and there was visibly no way to say when the email was sent —
 * which is how an agent following the spec ended up importing 2005 flights
 * dated 2026 (#285).
 */

import { z } from 'zod';

import { REQUESTABLE_DOMAINS } from '../services/parsing/parseDocument';

export const parseEmailSchema = z.object({
  emailContent: z.string().min(1, 'Email content is required').refine(
    (val) => val.length <= 10 * 1024 * 1024,
    { message: 'Email content too large (max 10MB)' }
  ),
  subject: z.string().optional().refine(
    (val) => !val || val.length <= 1000,
    { message: 'Subject too long (max 1000 characters)' }
  ),
  /**
   * `auto` asks the server to decide what the document is (#57). The default
   * stays `flight`, so no existing caller changes behaviour by upgrading.
   */
  domain: z.enum(REQUESTABLE_DOMAINS).optional().default('flight'),
  /**
   * When the email was SENT — normally straight from its own Date: header.
   *
   * Booking confirmations of a certain age write "16 JUL" and no year, because
   * the year was obvious to whoever read it that week. Without this the parser
   * anchors on today, so a 2005 email came back as a 2026 flight and the wrong
   * year went into the logbook without anything looking amiss (#285).
   *
   * Optional, and today remains the fallback: for a confirmation that just
   * arrived, today IS the reference.
   */
  referenceDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
});
