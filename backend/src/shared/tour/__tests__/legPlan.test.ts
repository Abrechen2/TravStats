import { planLegs, type ExistingLeg } from "../legPlan";

const leg = (id: string, from: string, to: string): ExistingLeg => ({
  id,
  fromStopId: from,
  toStopId: to,
});

describe("planLegs", () => {
  it("creates one leg per consecutive pair when nothing exists yet", () => {
    const plan = planLegs(["a", "b", "c"], []);
    expect(plan.create).toEqual([
      { fromStopId: "a", toStopId: "b" },
      { fromStopId: "b", toStopId: "c" },
    ]);
    expect(plan.keep).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("keeps untouched pairs when a stop is inserted in the middle", () => {
    // This is the endpoint-keying promise: inserting X between b and c
    // must NOT disturb the stored a→b line.
    const existing = [leg("l1", "a", "b"), leg("l2", "b", "c")];
    const plan = planLegs(["a", "b", "x", "c"], existing);

    expect(plan.keep.map((l) => l.id)).toEqual(["l1"]);
    expect(plan.deleteIds).toEqual(["l2"]);
    expect(plan.create).toEqual([
      { fromStopId: "b", toStopId: "x" },
      { fromStopId: "x", toStopId: "c" },
    ]);
  });

  it("keeps the joined pair's neighbours and creates the join when a stop is removed", () => {
    const existing = [leg("l1", "a", "b"), leg("l2", "b", "c"), leg("l3", "c", "d")];
    const plan = planLegs(["a", "c", "d"], existing);

    expect(plan.keep.map((l) => l.id)).toEqual(["l3"]);
    expect(plan.deleteIds.sort()).toEqual(["l1", "l2"]);
    expect(plan.create).toEqual([{ fromStopId: "a", toStopId: "c" }]);
  });

  it("supports a loop whose first and last stop are the same place", () => {
    const plan = planLegs(["a", "b", "c", "a"], []);
    expect(plan.create).toHaveLength(3);
    expect(plan.create[2]).toEqual({ fromStopId: "c", toStopId: "a" });
  });

  it("plans nothing for a route with fewer than two stops", () => {
    expect(planLegs([], [])).toEqual({ keep: [], create: [], deleteIds: [] });
    expect(planLegs(["a"], [])).toEqual({ keep: [], create: [], deleteIds: [] });
  });

  it("deletes every existing leg when the route is emptied", () => {
    const plan = planLegs([], [leg("l1", "a", "b")]);
    expect(plan.deleteIds).toEqual(["l1"]);
    expect(plan.create).toEqual([]);
  });

  it("treats a repeated pair as one leg", () => {
    // An out-and-back a→b→a→b would otherwise plan the same unique key twice
    // and violate @@unique([routeId, fromStopId, toStopId]) on insert.
    const plan = planLegs(["a", "b", "a", "b"], []);
    expect(plan.create).toEqual([
      { fromStopId: "a", toStopId: "b" },
      { fromStopId: "b", toStopId: "a" },
    ]);
  });
});
