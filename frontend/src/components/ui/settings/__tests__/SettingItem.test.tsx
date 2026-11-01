import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionControl,
  ChoiceControl,
  InputControl,
  JumpControl,
  SecretControl,
  StatusValue,
  SwitchControl,
} from "../controls";
import { JobStatus } from "../JobStatus";
import { OneShotExpertNote } from "../OneShotExpertNote";
import { ScopeNote } from "../ScopeMark";
import { ServiceCardShell } from "../ServiceCardShell";
import { SettingItem } from "../SettingItem";

afterEach(cleanup);

describe("the setting row (B1)", () => {
  it("draws name, scope, EXPERT pill, short line and the control", () => {
    render(
      <SettingItem
        title="Tageslimit"
        sub="Wie viele pro Tag"
        scope="allAccounts"
        expert
        control={<SwitchControl checked={false} onChange={() => undefined} />}
      />
    );
    expect(screen.getByText("Tageslimit")).toBeInTheDocument();
    expect(screen.getByText("Wie viele pro Tag")).toBeInTheDocument();
    expect(screen.getByText("settings:blocks.scope.allAccounts")).toBeInTheDocument();
    expect(document.querySelector("[data-expert-pill]")).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Tageslimit" })).toBeInTheDocument();
  });

  it("marks a device-only row", () => {
    render(<SettingItem title="Farbe" scope="device" />);
    expect(screen.getByText("settings:blocks.scope.device")).toBeInTheDocument();
  });

  it("puts the error line under the field and ties it to the control", () => {
    render(
      <SettingItem
        title="Adresse"
        error="Ich brauche https:// am Anfang der Adresse."
        control={<InputControl value="x" onChange={() => undefined} />}
      />
    );
    const input = screen.getByRole("textbox", { name: "Adresse" });
    const line = screen.getByRole("alert");
    expect(line).toHaveTextContent("https://");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(line.id);
  });

  it("warns about a missing required value in warn, not as an error (B15)", () => {
    render(
      <SettingItem
        title="Öffentliche Adresse"
        required="Fehlt noch."
        control={<InputControl value="" onChange={() => undefined} />}
      />
    );
    expect(document.querySelector("[data-required-warning]")).toHaveTextContent("Fehlt noch.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("locked means locked", () => {
  it("disables the control, sets aria-disabled and keeps it out of the tab order", async () => {
    const onChange = vi.fn();
    render(
      <>
        <button>before</button>
        <SettingItem
          title="Zeitzone"
          locked={{ why: "demo", reason: "" }}
          control={<SwitchControl checked={false} onChange={onChange} />}
        />
        <button>after</button>
      </>
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("before"));
    await userEvent.tab();
    expect(screen.getByText("after")).toHaveFocus();
    expect(sw.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("settings:blocks.lock.demo")).toBeInTheDocument();
  });

  it("locks a pill choice, a list, an input and an action the same way", () => {
    const noop = (): void => undefined;
    render(
      <SettingItem
        title="Alles"
        locked={{ why: "adminForbade", reason: "Der Admin hat das nicht freigegeben." }}
        control={
          <>
            <ChoiceControl
              label="pills"
              value="a"
              onChange={noop}
              options={[
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ]}
            />
            <InputControl value="" onChange={noop} />
            <ActionControl label="Los" onClick={noop} />
            <JumpControl label="Hin" onJump={noop} />
          </>
        }
      />
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-disabled", "true");
    screen.getAllByRole("radio").forEach((r) => expect(r).toBeDisabled());
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Los" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Los" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Hin/ })).toBeDisabled();
    expect(screen.getByText("Der Admin hat das nicht freigegeben.")).toBeInTheDocument();
  });

  it("an unmet dependency locks the control, with a jump that fixes it", async () => {
    const jump = vi.fn();
    render(
      <SettingItem
        title="Auto-Updates"
        dependency={{
          reason: "Immich ist nicht verbunden.",
          jump: { label: "Verbinden", onJump: jump },
        }}
        control={<SwitchControl checked onChange={() => undefined} />}
      />
    );
    expect(screen.getByRole("switch")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Verbinden/ }));
    expect(jump).toHaveBeenCalled();
  });

  it("'the admin forbade it' has a reason and NO jump", () => {
    render(
      <SettingItem
        title="KI"
        dependency={{ reason: "Der Admin hat keine KI freigegeben." }}
        control={<SwitchControl checked={false} onChange={() => undefined} />}
      />
    );
    expect(screen.getByText("Der Admin hat keine KI freigegeben.")).toBeInTheDocument();
    expect(within(document.querySelector("[data-dependency]")!).queryByRole("button")).toBeNull();
  });
});

describe("the controls", () => {
  it("a switch toggles", async () => {
    const onChange = vi.fn();
    render(
      <SettingItem title="An" control={<SwitchControl checked={false} onChange={onChange} />} />
    );
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("three options are pills, four are a list that answers to typing", async () => {
    const options = ["a", "b", "c", "d"].map((v) => ({ value: v, label: `Option ${v}` }));
    const onChange = vi.fn();
    const { rerender } = render(
      <ChoiceControl label="Wahl" value="a" options={options.slice(0, 3)} onChange={onChange} />
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    rerender(<ChoiceControl label="Wahl" value="a" options={options} onChange={onChange} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const list = screen.getByRole("combobox", { name: "Wahl" });
    expect(within(list).getAllByRole("option")).toHaveLength(4);
    await userEvent.selectOptions(list, "d");
    expect(onChange).toHaveBeenCalledWith("d");
  });

  it("a secret is never shown again; typing sends only what was typed", async () => {
    const onChange = vi.fn();
    render(
      <SettingItem title="API-Schlüssel" control={<SecretControl isSet onChange={onChange} />} />
    );
    const field = screen.getByLabelText("API-Schlüssel");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "settings:blocks.secret.set");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(field, "ab");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("a changed group value gets the accent border, an invalid one the bad border", () => {
    const { rerender } = render(
      <SettingItem
        title="X"
        changed
        control={<InputControl value="1" onChange={() => undefined} />}
      />
    );
    expect(screen.getByRole("textbox").getAttribute("style")).toContain("--ts-accent");
    rerender(
      <SettingItem
        title="X"
        error="Nein."
        control={<InputControl value="1" onChange={() => undefined} />}
      />
    );
    expect(screen.getByRole("textbox").getAttribute("style")).toContain("--ts-bad");
  });

  it("status and action render", async () => {
    const onClick = vi.fn();
    render(
      <SettingItem
        title="Status"
        control={
          <>
            <StatusValue>1,2 GB</StatusValue>
            <ActionControl label="Jetzt sichern" onClick={onClick} danger />
          </>
        }
      />
    );
    expect(screen.getByText("1,2 GB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Jetzt sichern" }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("background jobs (B11)", () => {
  const noop = (): void => undefined;
  it.each([
    ["waiting", { kind: "waiting" as const }, "settings:blocks.job.waiting"],
    [
      "running",
      { kind: "running" as const, what: "Lese Datei", done: 3, total: 10, eta: "1 Minute" },
      "Lese Datei",
    ],
    ["done", { kind: "done" as const, result: "12 Aufenthalte" }, "settings:blocks.job.done"],
    [
      "paused",
      { kind: "paused" as const, at: 3, total: 9, onResume: noop },
      "settings:blocks.job.paused",
    ],
    [
      "failed",
      { kind: "failed" as const, reason: "Platz", onRetry: noop },
      "settings:blocks.job.failed",
    ],
    ["unknown", { kind: "unknown" as const, onCheck: noop }, "settings:blocks.job.unknown"],
  ])("%s has its own state and sentence", (kind, job, text) => {
    render(<JobStatus job={job} />);
    expect(document.querySelector(`[data-job="${kind}"]`)).toHaveTextContent(text);
  });

  it("shows progress as a real progressbar, and an unknown outcome is not 'done'", async () => {
    const check = vi.fn();
    const { rerender } = render(
      <JobStatus job={{ kind: "running", what: "X", done: 3, total: 10 }} />
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
    rerender(<JobStatus job={{ kind: "unknown", onCheck: check }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.job.check" }));
    expect(check).toHaveBeenCalled();
  });
});

describe("the frame blocks", () => {
  it("a service card opens and closes; status-only has no toggle", async () => {
    const { rerender } = render(
      <ServiceCardShell title="Immich" pills={<span>Verbunden</span>}>
        <p>Einstellungen</p>
      </ServiceCardShell>
    );
    const toggle = screen.getByRole("button", { name: /Immich/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Einstellungen")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Einstellungen")).toBeInTheDocument();
    rerender(
      <ServiceCardShell title="Immich" statusOnly>
        <p>Einstellungen</p>
      </ServiceCardShell>
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Einstellungen")).not.toBeInTheDocument();
  });

  it("the one-time expert note offers 'Immer zeigen' and the page scope note names its kind", async () => {
    const always = vi.fn();
    render(
      <>
        <OneShotExpertNote onAlways={always} />
        <ScopeNote kind="mixed" />
      </>
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.oneShotAlways" }));
    expect(always).toHaveBeenCalled();
    expect(screen.getByText("settings:area.scope.mixed")).toBeInTheDocument();
  });
});
