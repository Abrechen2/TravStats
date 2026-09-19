/**
 * The one import path for the Prisma client and everything it generates.
 *
 * Prisma 7's `prisma-client` generator writes plain TypeScript to a path the
 * schema names (`src/generated/prisma`) instead of injecting a package into
 * node_modules. `@prisma/client` still exists as a package, but its types are
 * `export * from ".prisma/client/default"` — a path the new generator never
 * writes, so importing from it silently yields nothing: every `Prisma.*` type
 * degrades to an error and every `prisma.user` to "property does not exist".
 * That is exactly how the Dependabot bump of the CLI alone failed.
 *
 * So the ~106 call sites that used to say `from "@prisma/client"` now say
 * `from "<relative>/prisma"` and land here. One module knows where the
 * generated code lives; changing `output` in schema.prisma is a one-line edit
 * rather than a hundred.
 *
 * This file is deliberately free of side effects — no client is constructed
 * here. The singleton lives in `db.ts`, which imports from this module like
 * everything else, so a file that only needs the `Flight` type does not drag a
 * database connection and a 30-second timer in with it.
 */
export * from "./generated/prisma/client";
