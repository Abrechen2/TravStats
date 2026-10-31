import { LruMap } from "../lruMap";

describe("LruMap", () => {
  it("drops the least recently used entry past its capacity", () => {
    const m = new LruMap<string, number | null>(2);
    m.set("a", 1).set("b", 2);
    expect(m.get("a")).toBe(1); // a is now the freshest
    m.set("c", 3);
    expect(m.get("b")).toBeUndefined();
    expect(m.get("a")).toBe(1);
    expect(m.size).toBe(2);
  });

  it("keeps a cached null apart from a miss", () => {
    const m = new LruMap<string, null>(2);
    m.set("none", null);
    expect(m.get("none")).toBeNull();
    expect(m.get("other")).toBeUndefined();
  });

  it("rejects a capacity below one", () => {
    expect(() => new LruMap(0)).toThrow();
  });
});
