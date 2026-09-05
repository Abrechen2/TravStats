import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Button from "../Button";
import Chip from "../Chip";
import Dialog from "../Dialog";
import EmptyState, { type EmptyStateKind } from "../EmptyState";
import Pill, { DomainPill, StatusPill } from "../Pill";
import { Switch } from "../Field";
import { Table, TableRow, type TableColumn } from "../Table";
import { STATUS_TOKEN } from "../tokens";

describe("StatusPill", () => {
  it("paints an unknown status neutrally rather than in the cancelled red", () => {
    render(<StatusPill status="something-nobody-styled">Unbekannt</StatusPill>);
    const pill = screen.getByText("Unbekannt");
    // The defect this replaces: a catch-all else branch painted a 2019 flight
    // the same red as one that never took off.
    expect(pill.style.color).toContain("status-historical");
    expect(pill.style.color).not.toContain("status-cancelled");
  });

  it("dashes the border for a provisional status, and only for that", () => {
    const { rerender } = render(<StatusPill status="pending">Vorläufig</StatusPill>);
    expect(screen.getByText("Vorläufig").style.border).toContain("dashed");

    rerender(<StatusPill status="flown">Geflogen</StatusPill>);
    expect(screen.getByText("Geflogen").style.border).toContain("solid");
  });

  it("treats in_progress and completed as the flown colour, not as new hues", () => {
    // The Companion's own StatusPill does the same. Two extra states are
    // synonyms, and inventing a colour for each is how a fourth blue appears.
    expect(STATUS_TOKEN.in_progress).toBe(STATUS_TOKEN.flown);
    expect(STATUS_TOKEN.completed).toBe(STATUS_TOKEN.flown);
  });

  it("is never mono — mono stays codes and measurements", () => {
    render(
      <>
        <StatusPill status="flown">Geflogen</StatusPill>
        <DomainPill domain="cruise">Kreuzfahrt</DomainPill>
        <Pill color="var(--ts-accent)">Beta</Pill>
      </>
    );
    for (const label of ["Geflogen", "Kreuzfahrt", "Beta"]) {
      expect(screen.getByText(label).style.fontFamily).toBe("var(--ts-font-ui)");
    }
  });

  it("uses the 12 % / 45 % recipe, derived from the one colour", () => {
    render(<StatusPill status="flown">Geflogen</StatusPill>);
    const pill = screen.getByText("Geflogen");
    expect(pill.style.background).toContain("12%");
    expect(pill.style.border).toContain("45%");
    expect(pill.style.textTransform).toBe("uppercase");
  });
});

describe("EmptyState", () => {
  it("is never red — not in any of the four kinds", () => {
    const kinds: EmptyStateKind[] = ["nothing", "degraded", "pending", "unpaired"];
    for (const kind of kinds) {
      const { container, unmount } = render(<EmptyState kind={kind} title="Leer" icon={<i />} />);
      // An empty or waiting state is not a failure, and offline is a waiting
      // state. `bad` is reserved for cancelled, destructive and rejected.
      expect(container.innerHTML, `${kind} reaches for --ts-bad`).not.toContain("--ts-bad");
      unmount();
    }
  });

  it("carries the kind so a reviewer can see which of the four it is", () => {
    render(<EmptyState kind="degraded" title="Anbieter nicht erreichbar" log="503" />);
    expect(
      screen.getByText("Anbieter nicht erreichbar").closest("[data-empty-kind]")
    ).toHaveAttribute("data-empty-kind", "degraded");
  });
});

describe("Dialog", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Titel">
        Inhalt
      </Dialog>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the scrim but not on the panel", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Titel">
        Inhalt
      </Dialog>
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is a modal with a name, and renders nothing when closed", () => {
    const { rerender } = render(
      <Dialog open onClose={vi.fn()} title="Reise löschen?">
        Inhalt
      </Dialog>
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");

    rerender(
      <Dialog open={false} onClose={vi.fn()} title="Reise löschen?">
        Inhalt
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Table", () => {
  const columns: readonly TableColumn[] = [
    { key: "date", label: "Datum", width: "88px", mono: true, onNarrow: "subtitle" },
    { key: "route", label: "Strecke", width: "minmax(0,1fr)", onNarrow: "title" },
    { key: "code", label: "Flug", width: "120px", mono: true, onNarrow: "hide" },
  ];

  it("carries the table roles a grid does not get for free", () => {
    render(
      <Table columns={columns} label="Flüge">
        <TableRow columns={columns} cells={["12.09.26", "HAM → WAW", "LO380"]} />
      </Table>
    );
    // The export drew grid rows and left the roles off, which reads to a
    // screen reader as a stack of unrelated divs.
    expect(screen.getByRole("table", { name: "Flüge" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one row
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(3);
  });

  it("tells each cell what it becomes below 640px", () => {
    render(
      <Table columns={columns} label="Flüge">
        <TableRow columns={columns} cells={["12.09.26", "HAM → WAW", "LO380"]} />
      </Table>
    );
    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.getAttribute("data-narrow"))).toEqual(["subtitle", "title", "hide"]);
  });

  it("puts mono on the code column and not on the route", () => {
    render(
      <Table columns={columns} label="Flüge">
        <TableRow columns={columns} cells={["12.09.26", "HAM → WAW", "LO380"]} />
      </Table>
    );
    expect(screen.getByText("LO380").style.fontFamily).toBe("var(--ts-font-mono)");
    expect(screen.getByText("HAM → WAW").style.fontFamily).toBe("");
  });

  it("makes a clickable row reachable from the keyboard", () => {
    const onClick = vi.fn();
    render(
      <Table columns={columns} label="Flüge">
        <TableRow columns={columns} cells={["12.09.26", "HAM → WAW", "LO380"]} onClick={onClick} />
      </Table>
    );
    const row = screen.getAllByRole("row")[1];
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onClick).toHaveBeenCalled();
  });
});

describe("controls", () => {
  it("gives the switch a switch role and reports its state", () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Weniger Bewegung" />);
    const control = screen.getByRole("switch");
    expect(control).toBeChecked();
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("reports a chip's pressed state, so a filter is not just a colour", () => {
    render(
      <Chip active onClick={vi.fn()}>
        Geflogen
      </Chip>
    );
    expect(screen.getByRole("button", { name: /Geflogen/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("holds the button heights the design system names", () => {
    const { rerender } = render(<Button variant="primary">Speichern</Button>);
    expect(screen.getByRole("button").style.height).toBe("var(--ts-size-button-primary)");
    rerender(<Button variant="secondary">Abbrechen</Button>);
    expect(screen.getByRole("button").style.height).toBe("var(--ts-size-button-secondary)");
  });
});

/**
 * The hex ratchet, scoped to the library.
 *
 * Block 7 turns this into a repo-wide scan with a frozen list of today's
 * offenders. Here it can already be absolute: the primitives are new, so there
 * is nothing to freeze, and a value that is not a token in THIS directory is a
 * value the Companion never agreed to.
 */
describe("the primitives introduce no colour of their own", () => {
  const UI_DIR = resolve(__dirname, "..");

  const files = readdirSync(UI_DIR)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(UI_DIR, name));

  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  for (const file of files) {
    it(`${file.split("/").pop()} contains no hex literal`, () => {
      const source = readFileSync(file, "utf8");
      // `#i-plane` style icon refs and `#fff` are both caught; neither belongs.
      const hexes = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hexes, `${file} should read tokens, not paint`).toEqual([]);
    });
  }
});
