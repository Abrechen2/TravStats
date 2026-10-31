import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.list } }));

import CompanionPicker from "../CompanionPicker";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([
    { id: "1", name: "Anna", usageCount: 12 },
    { id: "2", name: "Jonas", usageCount: 3 },
  ]);
});

describe("CompanionPicker", () => {
  it("suggests known companions", async () => {
    render(<CompanionPicker value={[]} onChange={() => {}} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("combobox"), "An");
    expect(await screen.findByText("Anna")).toBeInTheDocument();
  });

  it("still accepts a name that is not in the list", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Neue Person{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Neue Person"]);
  });

  it("renders the current value as removable chips", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={["Anna"]} onChange={onChange} />);
    // The global react-i18next mock doesn't interpolate `t(key, options)`, so
    // the rendered aria-label can't be queried by translated text here.
    // A per-name test id identifies the correct chip's remove button even
    // when several chips are rendered side by side.
    await userEvent.click(screen.getByTestId("companion-remove-Anna"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("targets the correct chip's remove button when several are rendered", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={["Anna", "Jonas"]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("companion-remove-Jonas"));
    expect(onChange).toHaveBeenCalledWith(["Anna"]);
  });

  // A failed suggestion fetch must not block typing.
  it("stays usable when the suggestion list fails to load", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Anna{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Anna"]);
  });

  // Every form (flight, rail, bus, ferry, rental, ...) hosts this controlled
  // picker; a name only committed on Enter was silently lost on Save.
  describe("pending text", () => {
    function Form({ onSave }: { onSave: (v: string[]) => void }): JSX.Element {
      const [names, setNames] = useState<string[]>([]);
      return (
        <form
          onSubmit={(e): void => {
            e.preventDefault();
            onSave(names);
          }}
        >
          <CompanionPicker value={names} onChange={setNames} />
          <button type="submit">Save</button>
        </form>
      );
    }

    it("keeps a typed name when Save is clicked without pressing Enter", async () => {
      const onSave = vi.fn();
      render(<Form onSave={onSave} />);
      await userEvent.type(screen.getByRole("combobox"), "Neue Person");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(["Neue Person"]);
    });

    it("keeps a name containing a comma as one chip", async () => {
      const onSave = vi.fn();
      render(<Form onSave={onSave} />);
      await userEvent.type(screen.getByRole("combobox"), "Meier, Anna");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(["Meier, Anna"]);
    });

    it("does not add the half-typed query when a suggestion is clicked", async () => {
      const onSave = vi.fn();
      render(<Form onSave={onSave} />);
      await waitFor(() => expect(mocks.list).toHaveBeenCalled());
      await userEvent.type(screen.getByRole("combobox"), "An");
      await userEvent.click(await screen.findByText("Anna"));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(["Anna"]);
    });

    it("does not add a duplicate when Enter is followed by blur", async () => {
      const onSave = vi.fn();
      render(<Form onSave={onSave} />);
      await userEvent.type(screen.getByRole("combobox"), "Zoe{Enter}");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(["Zoe"]);
    });
  });
});
