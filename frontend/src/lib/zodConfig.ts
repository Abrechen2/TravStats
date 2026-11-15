/**
 * Keeps zod from probing for `eval` (forgejo#332).
 *
 * zod 4 compiles a faster validator with `new Function(...)` when it finds
 * the page allows it, and finds out by CONSTRUCTING one inside a try/catch.
 * Behind the nginx Content-Security-Policy (`script-src 'self'`, deliberately
 * without `'unsafe-eval'`) that probe throws, zod falls back to its plain
 * validators, and the browser logs a `script-src eval` violation on every page
 * load. Which code did it was not deck.gl or luma.gl but zod, whose copy the
 * bundler places in the deck.gl vendor chunk.
 *
 * The fallback already is what production runs, so `jitless` costs nothing
 * there; it only stops the probe — and the violation report — happening at all.
 * Import this before anything calls a schema.
 */
import { z } from "zod";

z.config({ jitless: true });
