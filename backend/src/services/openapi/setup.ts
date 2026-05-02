/**
 * One-time Zod extension. Imported by registry.ts before any schema is
 * registered, so `.openapi(...)` is available on every Zod node.
 *
 * Side-effect-only module — keeps the extension call out of the
 * registry boot path so it can be loaded by tests in isolation.
 */

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
