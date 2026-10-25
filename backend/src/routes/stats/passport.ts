/**
 * The passport and the country page behind each of its rows.
 *
 * Split out of `routes/stats.ts` (frozen by the size ratchet) when both gained
 * `?year=` (companion-redesign C4). Mounted from `stats.ts` at exactly the
 * position the routes used to occupy, so Express matches in the same order as
 * before. Bare responses, like the rest of that router
 * (docs/adr/0001-api-response-shape.md).
 *
 * ## `?year=`
 *
 * Optional, 1900–2100; anything else is a 400. With it the answer covers that
 * calendar year's evidence only — never a lifetime answer under a year label —
 * and a record no year can claim (undated) stays out of it. Which day each
 * source is dated by is in `services/stats/passportYear.ts`. Every answer
 * carries `scope: { year }` so a client can check it got the scope it asked
 * for; without `year` the body is the lifetime one plus `scope: { year: null }`.
 */

import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { CountryCodeParamSchema } from "../../schemas/statsQuery";
import { loadPassport } from "../../services/stats/passportLoader";
import { loadCountryDetail } from "../../services/stats/countryDetailLoader";
import { readYearQuery, statsScope } from "../../utils/stats/domainYear";

const router = Router();

/**
 * The passport — countries, their airports, and a continent quota.
 *
 * One endpoint rather than two raw ones the clients re-aggregate: the Companion
 * app already derives this screen client-side, and a second derivation in the
 * web frontend would be a third copy of arithmetic that has to agree. The
 * rules, and why each was chosen to match a figure published elsewhere on this
 * server, are in services/stats/passport.ts.
 */
router.get(
  "/passport",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const year = readYearQuery(req.query, res);
      if (year === null) return;
      const passport = await loadPassport(req.userId!, undefined, {}, { year });
      res.json({ ...passport, scope: statsScope(year) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /stats/countries/:code — one country, in detail (Forgejo #42).
 *
 * The drill-down behind a passport row. It answers for a country reached only
 * by cruise or by a recorded place too, because the passport lists those rows
 * and a 404 there would put the list and the page into the disagreement #42 is
 * about. The rules are in services/stats/countryDetail.ts.
 *
 * Bare object rather than a `{ success, data }` envelope: it sits beside
 * `/stats/countries` and `/stats/passport`, and a client that walks from a row
 * to its page should not have to unwrap a second shape halfway.
 *
 * Under `?year=` a country with no record in that year is a 404, like one
 * with no record at all: the year's passport has no row for it either.
 */
router.get(
  "/countries/:code",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = CountryCodeParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid country", details: parsed.error.issues });
        return;
      }
      const year = readYearQuery(req.query, res);
      if (year === null) return;

      const detail = await loadCountryDetail(userId, parsed.data.code, { year });

      if (!detail) {
        // Nothing evidences this country — including a code the catalogue does
        // not know. Both are "you have not been there", and saying so is
        // better than an empty page that looks like a loading failure.
        res.status(404).json({ error: "No record of this country" });
        return;
      }

      res.json({ ...detail, scope: statsScope(year) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
