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
});
