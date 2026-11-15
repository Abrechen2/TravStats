import { withPublicStays } from "../export/allDataExport";

/** The export carries a trip's shared items and the account's own, never a co-planner's (forgejo#398). */
describe("account export of a trip's packing list", () => {
  it("leaves out another member's personal items", () => {
    const user = {
      id: "owner-1",
      dawarichStays: [],
      trips: [
        {
          packingList: {
            rev: 2,
            items: [
              { id: "a", label: "Pass", done: false },
              { id: "b", label: "Tent", done: false, scope: "shared" },
              {
                id: "c",
                label: "Her insulin",
                done: false,
                scope: "personal",
                ownerPrincipal: { server: "local", subjectId: "someone-else" },
              },
            ],
          },
        },
        { packingList: null },
      ],
    };
    const exported = withPublicStays(user);
    expect(exported.trips[0].packingList?.items.map((i: { id: string }) => i.id)).toEqual([
      "a",
      "b",
    ]);
    expect(exported.trips[1].packingList).toBeNull();
  });

  it("does not carry a plan's stored state.packing, which can hold a co-planner's personal items", () => {
    const user = {
      id: "owner-1",
      dawarichStays: [],
      trips: [
        {
          packingList: { rev: 1, items: [{ id: "a", label: "Pass", done: false }] },
          travelPlan: {
            id: "plan-1",
            revision: 3,
            state: {
              destination: "Lisbon",
              packing: [
                {
                  id: "c",
                  label: "Her insulin",
                  scope: "personal",
                  ownerMemberId: "member-2",
                  packed: false,
                },
              ],
              tasks: [],
            },
          },
        },
      ],
    };
    const exported = withPublicStays(user);
    const state = exported.trips[0].travelPlan?.state as Record<string, unknown>;
    expect("packing" in state).toBe(false);
    expect(state.destination).toBe("Lisbon");
    expect(JSON.stringify(exported)).not.toContain("Her insulin");
  });
});
