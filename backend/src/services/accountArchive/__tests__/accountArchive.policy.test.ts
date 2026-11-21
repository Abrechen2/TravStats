/**
 * The account archive's table policy against the live schema (forgejo#433): a table
 * a migration adds must be classified before the archive can be written, so a new
 * kind of user data cannot silently stay behind when an account moves.
 */
import { prisma } from "../../../db";
import { readCatalog, type Catalog, type Db } from "../catalog";
import { buildPlan } from "../plan";
import { isDataPolicy, TABLE_POLICY } from "../tablePolicy";

let catalog: Catalog;

beforeAll(async () => {
  catalog = await readCatalog(prisma as unknown as Db);
});

describe("account archive table policy", () => {
  it("classifies every table of the database, and names no table that does not exist", () => {
    const tables = [...catalog.keys()].sort();
    expect(tables.filter((t) => !TABLE_POLICY[t])).toEqual([]);
    expect(Object.keys(TABLE_POLICY).filter((t) => !catalog.has(t))).toEqual([]);
  });

  it("builds an insert order and a selection for every travelling table", () => {
    const plan = buildPlan(catalog);
    expect(plan.unclassified).toEqual([]);
    expect(plan.tables.length).toBe(Object.values(TABLE_POLICY).filter(isDataPolicy).length);
  });

  it("only strips, re-keys, renames or defers columns that exist, and strips only nullable ones", () => {
    const problems: string[] = [];
    for (const [table, policy] of Object.entries(TABLE_POLICY)) {
      const info = catalog.get(table);
      if (!info) continue;
      const column = (name: string) => info.columns.find((c) => c.name === name);
      const named: Array<[string, readonly string[] | undefined]> = isDataPolicy(policy)
        ? [
            ["strip", policy.strip],
            ["rekey", policy.rekey],
            ["idColumns", policy.idColumns],
            [
              "files",
              (policy.files ?? []).flatMap((f) =>
                [f.column, f.mime, f.format, f.sha256, f.size, ...(f.linkedWhen ?? [])].filter(
                  (c): c is string => typeof c === "string"
                )
              ),
            ],
            ["late", policy.late],
          ]
        : policy.kind === "info"
          ? [["omit", policy.omit]]
          : [];
      for (const [kind, cols] of named) {
        for (const col of cols ?? []) {
          if (!column(col)) problems.push(`${table}.${col} (${kind}) does not exist`);
          if ((kind === "strip" || kind === "late") && column(col)?.notNull) {
            problems.push(`${table}.${col} (${kind}) is NOT NULL`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("never lets a credential column travel", () => {
    const credential = /(api_key|_token$|_secret$|password|hash$|^two_factor)/;
    // Named like a credential, but a content digest the record needs.
    const notCredentials = new Set(["travel_plan_proposals.input_hash"]);
    const leaks: string[] = [];
    for (const [table, policy] of Object.entries(TABLE_POLICY)) {
      if (!isDataPolicy(policy)) continue;
      for (const c of catalog.get(table)?.columns ?? []) {
        const name = `${table}.${c.name}`;
        if (
          credential.test(c.name) &&
          !(policy.strip ?? []).includes(c.name) &&
          !notCredentials.has(name)
        ) {
          leaks.push(name);
        }
      }
    }
    expect(leaks.sort()).toEqual([]);
  });
});
