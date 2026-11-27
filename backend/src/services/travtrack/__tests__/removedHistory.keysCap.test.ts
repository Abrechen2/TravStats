import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { removedKeysSql } from "../removedHistory";

/**
 * Codex P2 on rc.48: the keys of a removal were aggregated with
 * `CASE WHEN count(*) <= cap THEN json_agg(…) END` over every removed point, so a removal of
 * millions built the whole JSON array before throwing it away. The aggregate must see at
 * most cap + 1 rows.
 */
type PlanNode = { "Node Type": string; "Actual Rows": number; Plans?: PlanNode[] };

function aggregateInputRows(node: PlanNode): number[] {
  const own =
    node["Node Type"] === "Aggregate" ? (node.Plans ?? []).map((p) => p["Actual Rows"]) : [];
  return [...own, ...(node.Plans ?? []).flatMap(aggregateInputRows)];
}

const keysOver = (n: number, cap: number) => Prisma.sql`
  WITH m AS MATERIALIZED (
    SELECT g AS t_s, 47.0 + g / 1e6 AS lat, 10.0 AS lon FROM generate_series(1, ${n}) g
  )
  SELECT ${removedKeysSql(cap)} AS keys`;

describe("removed-history keys", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("feeds the key aggregate at most cap + 1 rows, however many points were removed", async () => {
    const [plan] = await prisma.$queryRaw<Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>>(
      Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${keysOver(2000, 10)}`
    );
    const inputs = aggregateInputRows(plan["QUERY PLAN"][0].Plan);
    expect(inputs.length).toBeGreaterThan(0);
    expect(Math.max(...inputs)).toBeLessThanOrEqual(11);
  });

  it("still answers the keys under the cap and null over it", async () => {
    const [under] = await prisma.$queryRaw<Array<{ keys: unknown[] | null }>>(keysOver(5, 10));
    expect(under.keys).toHaveLength(5);
    const [over] = await prisma.$queryRaw<Array<{ keys: unknown[] | null }>>(keysOver(11, 10));
    expect(over.keys).toBeNull();
    const [exact] = await prisma.$queryRaw<Array<{ keys: unknown[] | null }>>(keysOver(10, 10));
    expect(exact.keys).toHaveLength(10);
  });
});
