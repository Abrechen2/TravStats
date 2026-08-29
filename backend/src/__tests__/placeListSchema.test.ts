import { createPlaceListSchema, updatePlaceListSchema } from "../schemas/placeList";

/**
 * `labelMode` is what a list says its places should be labelled with on the
 * map. It is only ever the list's DEFAULT — the map's own control can override
 * it for the whole map — so the column carries two values and nothing else.
 */
describe("placeList labelMode", () => {
  it("accepts both modes on create", () => {
    for (const labelMode of ["name", "icon"] as const) {
      const parsed = createPlaceListSchema.safeParse({ name: "McDonald's", labelMode });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.labelMode).toBe(labelMode);
    }
  });

  it("defaults to the name when the client says nothing", () => {
    // Absent rather than "name": leaving it out of a PATCH must not overwrite
    // a list that already chose icons. The column default supplies "name" on
    // create; the schema's job is only to keep silence silent.
    const parsed = createPlaceListSchema.safeParse({ name: "Maccis" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.labelMode).toBeUndefined();
  });

  it("rejects a mode nothing can draw", () => {
    expect(createPlaceListSchema.safeParse({ name: "Maccis", labelMode: "emoji" }).success).toBe(
      false
    );
    expect(createPlaceListSchema.safeParse({ name: "Maccis", labelMode: "" }).success).toBe(false);
    expect(createPlaceListSchema.safeParse({ name: "Maccis", labelMode: null }).success).toBe(false);
  });

  it("can be changed on its own", () => {
    // The list detail page sends exactly this when the switch is flipped, so
    // the update schema's "at least one field" rule has to count it.
    const parsed = updatePlaceListSchema.safeParse({ labelMode: "icon" });
    expect(parsed.success).toBe(true);
  });

  it("still refuses an update that changes nothing", () => {
    expect(updatePlaceListSchema.safeParse({}).success).toBe(false);
  });
});
