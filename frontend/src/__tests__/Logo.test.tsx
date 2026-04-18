import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LogoMark, LogoMarkFilled, LogoWordmark, LogoLockup } from "../components/Brand/Logo";

describe("Brand/Logo", () => {
  describe("LogoMark", () => {
    it("renders an accessible <img> with a <title> naming the brand", () => {
      const { container } = render(<LogoMark />);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute("role", "img");
      expect(container.querySelector("title")?.textContent).toBe("TravStats");
    });

    it("honours a custom title prop", () => {
      const { container } = render(<LogoMark title="Take me home" />);
      expect(container.querySelector("title")?.textContent).toBe("Take me home");
    });

    it("scales width and height from the size prop and keeps aspect ratio", () => {
      const { container } = render(<LogoMark size={60} />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("width", "60");
      expect(svg).toHaveAttribute("height", "70"); // 60 * 140 / 120
    });

    it("applies the default amber accent token when no color is passed", () => {
      const { container } = render(<LogoMark />);
      const tagBorder = container.querySelector("path");
      expect(tagBorder?.getAttribute("stroke")).toBe("var(--accent)");
    });
  });

  describe("LogoMarkFilled", () => {
    it("uses var(--bg-base) as the inverse colour by default so the mark survives theme switches", () => {
      const { container } = render(<LogoMarkFilled />);
      const inverseFills = Array.from(container.querySelectorAll("[fill]"))
        .map((node) => node.getAttribute("fill"))
        .filter((v): v is string => Boolean(v));
      expect(inverseFills).toContain("var(--bg-base)");
    });

    it("lets callers override the inverse colour via the bg prop", () => {
      const { container } = render(<LogoMarkFilled bg="#ffffff" />);
      const circle = container.querySelector("circle");
      expect(circle?.getAttribute("fill")).toBe("#ffffff");
    });
  });

  describe("LogoWordmark", () => {
    it("renders TRAV and STATS as discrete spans with an aria-hidden cross-dot in between", () => {
      const { container } = render(<LogoWordmark />);
      const spans = container.querySelectorAll("span > span");
      const texts = Array.from(spans).map((s) => s.textContent);
      expect(texts).toContain("TRAV");
      expect(texts).toContain("STATS");
      const innerSvg = container.querySelector("svg");
      expect(innerSvg).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("LogoLockup", () => {
    it("composes LogoMark + LogoWordmark in a flex container", () => {
      const { container } = render(<LogoLockup />);
      // Outer mark svg (role=img) + inner cross-dot svg (aria-hidden)
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBe(2);
      expect(svgs[0].getAttribute("role")).toBe("img");
      expect(svgs[1].getAttribute("aria-hidden")).toBe("true");
    });

    it("switches to column layout when layout=stacked", () => {
      const { container } = render(<LogoLockup layout="stacked" />);
      const outer = container.firstChild as HTMLElement;
      expect(outer.style.flexDirection).toBe("column");
    });
  });
});
