/**
 * Side-effect-only module kept as the registry's explicit statement that the
 * Zod OpenAPI extension must be in place before anything registers a schema.
 *
 * The extension itself lives in `schemas/zod` — see the comment there for why
 * it has to be anchored to the module that hands out `z` rather than applied
 * from here. Importing this file is still correct; it is simply no longer the
 * thing that makes the order come out right.
 */

import "../../schemas/zod";
