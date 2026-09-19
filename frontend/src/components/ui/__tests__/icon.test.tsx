import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "../Icon";
import { LUCIDE, type IconName } from "../icons/lucide";

/**
 * The vendored Lucide subset is generated from the design export's sprite.
 * The first generator dropped every attribute whose name holds a digit —
 * `x1`, `y1`, `x2`, `y2` — so each `<line>` rendered with no geometry and
 * "Einheiten & Formate" showed a dot where its sliders should be. These pin
 * the data, not the drawing: every element carries the attributes its shape
 * cannot exist without.
 */
const REQUIRED: Record<string, readonly string[]> = {
  path: ["d"],
  line: ["x1", "y1", "x2", "y2"],
  circle: ["cx", "cy", "r"],
  rect: ["width", "height"],
  polyline: ["points"],
  polygon: ["points"],
  ellipse: ["cx", "cy", "rx", "ry"],
};

describe("vendored Lucide icons", () => {
  it.each(Object.keys(LUCIDE) as IconName[])("%s has the geometry its shapes need", (name) => {
    for (const [tag, attrs] of LUCIDE[name]) {
      for (const attribute of REQUIRED[tag]) {
        expect(attrs, `${name}: <${tag}> without ${attribute}`).toHaveProperty(attribute);
      }
    }
  });

  it("renders as decoration unless it is given a label", () => {
    const { container, rerender } = render(<Icon name="bell" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<Icon name="bell" label="Benachrichtigungen" />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Benachrichtigungen");
  });
});
