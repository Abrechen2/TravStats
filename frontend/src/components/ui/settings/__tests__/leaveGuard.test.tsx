import type { JSX } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupStateMark } from "../SaveStateMark";
import { InputControl } from "../controls";
import LeaveGuardHost from "../LeaveGuardHost";
import { useGuardedNavigate } from "../leaveGuard";
import { SettingItem } from "../SettingItem";
import { useGroupSave } from "../useGroupSave";
import { resetWriteQueue } from "../writeQueue";

const refused = (): Error => Object.assign(new Error("400"), { response: { status: 400 } });

function Group({ write }: { write: (draft: { url: string }) => Promise<void> }): JSX.Element {
  const group = useGroupSave({
    id: "addresses",
    label: "Adressen",
    saved: { url: "https://a" },
    write,
  });
  return (
    <div>
      <SettingItem
        title="Adresse"
        changed={group.isChanged("url")}
        control={<InputControl value={group.draft.url} onChange={(url) => group.edit({ url })} />}
      />
      <GroupStateMark state={group.state} reason={group.reason} />
      <button onClick={() => void group.save()}>Speichern</button>
      <button onClick={group.discard}>Verwerfen hier</button>
    </div>
  );
}

function SearchHit(): JSX.Element {
  const navigate = useGuardedNavigate();
  return (
    <button onClick={() => navigate("/settings/data", { state: { highlight: "x" } })}>
      Treffer
    </button>
  );
}

function Where(): JSX.Element {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function App({ write }: { write: (draft: { url: string }) => Promise<void> }): JSX.Element {
  return (
    <BrowserRouter>
      <LeaveGuardHost />
      <Link to="/settings/data">Menü Daten</Link>
      <SearchHit />
      <Where />
      <Routes>
        <Route path="/settings/server" element={<Group write={write} />} />
        <Route path="*" element={<p>andere Seite</p>} />
      </Routes>
    </BrowserRouter>
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/settings/server");
});
afterEach(async () => {
  cleanup();
  act(() => resetWriteQueue());
  await waitFor(() =>
    expect(
      Boolean((window.history.state as Record<string, unknown> | null)?.__travstatsUnsavedChanges)
    ).toBe(false)
  );
});

const onSentinel = (): boolean =>
  Boolean((window.history.state as Record<string, unknown> | null)?.__travstatsUnsavedChanges);

const dirty = async (): Promise<void> => {
  const field = screen.getByRole("textbox", { name: "Adresse" });
  await userEvent.clear(field);
  await userEvent.type(field, "https://b");
};

describe("a group with an explicit save", () => {
  it("says 'Nicht gespeichert' while the draft differs and nothing when it does not", async () => {
    render(<App write={vi.fn()} />);
    expect(screen.queryByText("settings:blocks.save.unsaved")).not.toBeInTheDocument();
    await dirty();
    expect(screen.getByText("settings:blocks.save.unsaved")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Verwerfen hier"));
    expect(screen.queryByText("settings:blocks.save.unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Adresse" })).toHaveValue("https://a");
  });

  it("a failed save keeps the draft and the group stays 'not saved' for the leave guard", async () => {
    render(<App write={vi.fn().mockRejectedValue(refused())} />);
    await dirty();
    await userEvent.click(screen.getByText("Speichern"));
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(screen.getByRole("textbox", { name: "Adresse" })).toHaveValue("https://b");
    await userEvent.click(screen.getByText("Menü Daten"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a saved group no longer holds the user back", async () => {
    render(<App write={vi.fn().mockResolvedValue(undefined)} />);
    await dirty();
    await userEvent.click(screen.getByText("Speichern"));
    expect(await screen.findByText("settings:blocks.save.saved")).toBeInTheDocument();
    // The history sentinel is taken away asynchronously (see form/unsavedChanges).
    await waitFor(() => expect(onSentinel()).toBe(false));
    await userEvent.click(screen.getByText("Menü Daten"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("andere Seite")).toBeInTheDocument();
  });
});

describe("leaving a page with unsaved groups", () => {
  it("a menu click asks first; 'Bleiben' stays with the draft intact", async () => {
    render(<App write={vi.fn()} />);
    await dirty();
    await userEvent.click(screen.getByText("Menü Daten"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Adressen");
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/server");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.leave.stay" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Adresse" })).toHaveValue("https://b");
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/server");
  });

  it("a menu click then 'Verwerfen' leaves and drops the draft", async () => {
    render(<App write={vi.fn()} />);
    await dirty();
    await userEvent.click(screen.getByText("Menü Daten"));
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.leave.discard" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/settings/data"));
    expect(screen.getByText("andere Seite")).toBeInTheDocument();
  });

  it("a search hit (programmatic navigation) asks too, and carries its state when confirmed", async () => {
    render(<App write={vi.fn()} />);
    await dirty();
    await userEvent.click(screen.getByText("Treffer"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/server");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.leave.discard" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/settings/data"));
    expect((window.history.state as { usr?: { highlight?: string } }).usr?.highlight).toBe("x");
  });

  it("goes straight through when nothing is unsaved", async () => {
    render(<App write={vi.fn()} />);
    await userEvent.click(screen.getByText("Treffer"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/data");
  });

  it("a link to the same page is not a departure", async () => {
    render(
      <BrowserRouter>
        <LeaveGuardHost />
        <Link to="/settings/server#x">Selbe Seite</Link>
        <Group write={vi.fn()} />
      </BrowserRouter>
    );
    await dirty();
    await userEvent.click(screen.getByText("Selbe Seite"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks the browser to confirm a reload while a group is unsaved", async () => {
    render(<App write={vi.fn()} />);
    await dirty();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not ask the browser when nothing is unsaved", () => {
    render(<App write={vi.fn()} />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("the browser's Back asks the same question", async () => {
    window.history.replaceState(null, "", "/start");
    window.history.pushState(null, "", "/settings/server");
    render(<App write={vi.fn()} />);
    await dirty();
    act(() => window.history.back());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.leave.stay" }));
    expect(screen.getByRole("textbox", { name: "Adresse" })).toHaveValue("https://b");
  });
});
