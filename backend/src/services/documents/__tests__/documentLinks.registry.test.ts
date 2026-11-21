import { prisma } from "../../../db";
import { DOMAIN_KEYS } from "../../../shared/domains";
import { ENTRY_TYPES } from "../documentFormats";
import { DOMAIN_LINK_TARGETS, LINK_TARGETS } from "../documentLinks";

/**
 * The link targets are ONE registry (plan 2026-11-21-document-links, rule 1),
 * held here against the domain list and the database, as `shareTypes.test.ts`
 * holds the shareable types: a domain added without a link target or a written
 * reason fails, and so does a target column the registry does not know.
 */

const snake = (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("document link targets", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("classifies every domain: a target of its own, or a reason why not", () => {
    for (const domain of DOMAIN_KEYS) {
      const rule = DOMAIN_LINK_TARGETS[domain];
      expect(rule).toBeDefined();
      if (typeof rule === "string") {
        expect(ENTRY_TYPES).toContain(rule);
      } else {
        expect(rule.notLinked.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("names a domain's target only once", () => {
    const targets = Object.values(DOMAIN_LINK_TARGETS).filter((r) => typeof r === "string");
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("matches the foreign keys of document_links and the owner columns of documents", async () => {
    const fks = async (table: string) =>
      (
        await prisma.$queryRaw<{ column_name: string }[]>`
          SELECT kcu.column_name FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          WHERE tc.table_name = ${table} AND tc.constraint_type = 'FOREIGN KEY'`
      )
        .map((r) => r.column_name)
        .filter((c) => !["document_id", "user_id"].includes(c))
        .sort();
    const registered = ENTRY_TYPES.map((t) => snake(LINK_TARGETS[t].column)).sort();
    expect(await fks("document_links")).toEqual(registered);
    expect(await fks("documents")).toEqual(registered);
  });
});
