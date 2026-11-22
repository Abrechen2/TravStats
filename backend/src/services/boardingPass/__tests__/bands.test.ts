import { passBands } from "../bands";

describe("passBands — one image region per boarding pass", () => {
  it("cuts stacked passes into rows, halfway between their barcodes", () => {
    const bands = passBands(2300, 2000, [
      { x: 1900, y: 100, width: 300, height: 600 },
      { x: 1900, y: 1200, width: 300, height: 600 },
    ]);
    expect(bands).toEqual([
      { x: 0, y: 0, width: 2300, height: 950 },
      { x: 0, y: 950, width: 2300, height: 1050 },
    ]);
  });

  it("cuts side-by-side passes into columns, in the barcodes' own order", () => {
    const bands = passBands(3000, 1000, [
      { x: 2500, y: 300, width: 200, height: 400 },
      { x: 1000, y: 300, width: 200, height: 400 },
    ]);
    expect(bands[1]).toEqual({ x: 0, y: 0, width: 1850, height: 1000 });
    expect(bands[0]).toEqual({ x: 1850, y: 0, width: 1150, height: 1000 });
  });

  it("keeps the whole image for a single pass", () => {
    expect(passBands(800, 600, [{ x: 10, y: 10, width: 100, height: 100 }])).toEqual([
      { x: 0, y: 0, width: 800, height: 600 },
    ]);
  });
});
