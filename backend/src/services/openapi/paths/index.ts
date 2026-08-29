/**
 * Path registration entry point.
 *
 * Importing this module has the side effect of registering every
 * documented endpoint on the shared registry. It is split per domain
 * because a single file cannot hold the full surface inside the 800-line
 * limit — the previous single `paths.ts` was already at 681 lines while
 * covering 18 of 326 endpoints.
 *
 * Adding a domain means adding a module here. Forgetting to is caught by
 * `openapi.coverage.test.ts`, not by review.
 */

import "./shared";

import "./flights";
import "./trips";
import "./tours";
import "./companions";
import "./airports";
import "./stats";
import "./parsing";
import "./tokens";
import "./diagnostics";
import "./cruises";
import "./catalog";
import "./misc";
import "./xlsxImport";
