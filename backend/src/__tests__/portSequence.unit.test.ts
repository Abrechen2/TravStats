import { buildEffectivePortSequence } from "../shared/cruise/portSequence";

interface P {
  id: number;
  name: string;
}

const port = (id: number, name: string): P => ({ id, name });

const HAMBURG = port(1, "Hamburg");
const SOUTHAMPTON = port(2, "Southampton");
const VIGO = port(3, "Vigo");
const LISBON = port(4, "Lisbon");

describe("buildEffectivePortSequence", () => {
  it("prepends departure and appends arrival around port calls", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [SOUTHAMPTON, VIGO], LISBON);
    expect(seq.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  it("yields a two-port route for an A-to-B cruise without stops", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [], LISBON);
    expect(seq.map((p) => p.id)).toEqual([1, 4]);
  });

  it("skips departure when it duplicates the first port call", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [HAMBURG, VIGO], LISBON);
    expect(seq.map((p) => p.id)).toEqual([1, 3, 4]);
  });

  it("skips arrival when it duplicates the last port call", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [VIGO, LISBON], LISBON);
    expect(seq.map((p) => p.id)).toEqual([1, 3, 4]);
  });

  it("keeps a same-port round trip as a single entry when there are no stops", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [], HAMBURG);
    expect(seq.map((p) => p.id)).toEqual([1]);
  });

  it("keeps a round trip with stops as a closed loop", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [VIGO], HAMBURG);
    expect(seq.map((p) => p.id)).toEqual([1, 3, 1]);
  });

  it("handles missing departure/arrival ports", () => {
    expect(buildEffectivePortSequence(null, [VIGO, LISBON], null).map((p) => p.id)).toEqual([3, 4]);
    expect(buildEffectivePortSequence(null, [], null)).toEqual([]);
  });

  it("never dedupes repeated ports in the middle of the itinerary", () => {
    const seq = buildEffectivePortSequence(HAMBURG, [VIGO, VIGO], LISBON);
    expect(seq.map((p) => p.id)).toEqual([1, 3, 3, 4]);
  });
});
