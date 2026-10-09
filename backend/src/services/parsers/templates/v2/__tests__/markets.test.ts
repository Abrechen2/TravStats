import { orderByMarket } from "../markets";
import { validTemplate } from "./fixtures";

const de = validTemplate({ id: "lodging:de-one", markets: ["DE"] });
const deAt = validTemplate({ id: "lodging:de-at", markets: ["AT", "DE"] });
const global = validTemplate({ id: "lodging:global", markets: [] });
const es = validTemplate({ id: "lodging:es-one", markets: ["ES"] });
const fr = validTemplate({ id: "lodging:fr-one", markets: ["FR"] });

const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("orderByMarket", () => {
  it("puts home-market templates first, then global ones, then the rest", () => {
    const ordered = orderByMarket([es, global, de, fr, deAt], "DE");
    expect(ids(ordered)).toEqual([
      "lodging:de-one",
      "lodging:de-at",
      "lodging:global",
      "lodging:es-one",
      "lodging:fr-one",
    ]);
  });

  it("never drops a template of another market", () => {
    const input = [es, fr, de, global];
    const ordered = orderByMarket(input, "ES");
    expect(ordered).toHaveLength(input.length);
    expect(new Set(ids(ordered))).toEqual(new Set(ids(input)));
    expect(ids(ordered)[0]).toBe("lodging:es-one");
  });

  it("keeps the incoming order within a rank (stable)", () => {
    const ordered = orderByMarket([fr, es, deAt, de], "DE");
    expect(ids(ordered)).toEqual([
      "lodging:de-at",
      "lodging:de-one",
      "lodging:fr-one",
      "lodging:es-one",
    ]);
  });

  it("returns the order unchanged without a home country", () => {
    const input = [es, global, de];
    expect(ids(orderByMarket(input, null))).toEqual(ids(input));
    expect(ids(orderByMarket(input))).toEqual(ids(input));
  });

  it("does not mutate the input", () => {
    const input = [es, de];
    orderByMarket(input, "DE");
    expect(ids(input)).toEqual(["lodging:es-one", "lodging:de-one"]);
  });
});
