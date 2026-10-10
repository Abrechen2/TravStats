import { bodyOf, seatPositionOf } from "../seatPosition";

/** forgejo#256: a seat letter is placed only where its cabin decides it. */
describe("seatPositionOf", () => {
  it("knows A and K as windows and C, D as aisles on every aircraft", () => {
    for (const aircraft of ["A320", "B777-300ER", null]) {
      expect(seatPositionOf("A", aircraft, "economy")).toBe("window");
      expect(seatPositionOf("C", aircraft, "economy")).toBe("aisle");
      expect(seatPositionOf("D", aircraft, "economy")).toBe("aisle");
    }
    expect(seatPositionOf("K", "A350-900", "economy")).toBe("window");
  });

  it("reads F as a window on a narrow-body and abstains on a wide-body", () => {
    expect(seatPositionOf("F", "Airbus A320neo", "economy")).toBe("window");
    expect(seatPositionOf("F", "Boeing 737-800", "economy")).toBe("window");
    // 3-4-3: F is a middle seat; 3-3-3: an aisle. Not knowable from the letter.
    expect(seatPositionOf("F", "Boeing 777-300ER", "economy")).toBe("unknown");
    expect(seatPositionOf("F", null, "economy")).toBe("unknown");
  });

  it("never calls H a middle seat — it is one on 3-3-3 and an aisle on 3-4-3", () => {
    expect(seatPositionOf("H", "B777", "economy")).toBe("unknown");
    expect(seatPositionOf("G", "A330-300", "economy")).toBe("aisle");
    expect(seatPositionOf("J", "B777", "economy")).toBe("middle");
  });

  it("places only windows and aisles in a premium cabin", () => {
    expect(seatPositionOf("E", "B787-9", "business")).toBe("unknown");
    expect(seatPositionOf("A", "B787-9", "business")).toBe("window");
    expect(seatPositionOf("G", "B787-9", "business")).toBe("aisle");
  });

  it("tells narrow- from wide-bodies by type", () => {
    expect(bodyOf("A321neo")).toBe("narrow");
    expect(bodyOf("Embraer E190")).toBe("narrow");
    expect(bodyOf("A380-800")).toBe("wide");
    expect(bodyOf("Boeing 787-9")).toBe("wide");
    expect(bodyOf("Cessna 172")).toBeNull();
  });
});
