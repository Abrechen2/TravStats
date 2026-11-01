import type { JSX } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveStateMark } from "../SaveStateMark";
import { useSettingWrite } from "../useSettingWrite";
import { flushWrites, resetWriteQueue, SettingWriteError, type WriteFn } from "../writeQueue";

const refused = (): Error => Object.assign(new Error("400"), { response: { status: 400 } });

function Row({ saved, write }: { saved: string; write: WriteFn<string> }): JSX.Element {
  const w = useSettingWrite("unit", saved, write);
  return (
    <div>
      <div data-testid="shown">{w.value}</div>
      <button onClick={() => w.choose("lb")}>pick lb</button>
      <button onClick={() => w.choose("kg")}>pick kg</button>
      <SaveStateMark state={w.state} reason={w.reason} onRetry={w.retry} onDiscard={w.discard} />
    </div>
  );
}

const click = (name: string): void => {
  act(() => screen.getByRole("button", { name }).click());
};
const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
  vi.useRealTimers();
});

describe("an immediate row's save state", () => {
  it("goes waiting -> saving -> saved -> resting", async () => {
    let finish: () => void = () => undefined;
    const write = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    expect(screen.getByText("settings:blocks.save.waiting")).toBeInTheDocument();
    await tick(400);
    expect(write).toHaveBeenCalledWith("lb", { keepalive: false });
    await act(async () => finish());
    expect(screen.getByText("settings:blocks.save.saved")).toBeInTheDocument();
    await tick(2500);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a failed save keeps the user's choice and says so, with both ways out", async () => {
    const write = vi.fn().mockRejectedValue(refused());
    const { rerender } = render(<Row saved="kg" write={write} />);
    click("pick lb");
    await tick(400);
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(screen.getByTestId("shown")).toHaveTextContent("lb");
    // A re-render with the unchanged saved value must not snap the choice back.
    rerender(<Row saved="kg" write={write} />);
    expect(screen.getByTestId("shown")).toHaveTextContent("lb");
    expect(screen.getByRole("button", { name: "settings:blocks.save.retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings:blocks.save.discard" })
    ).toBeInTheDocument();
  });

  it("Verwerfen brings back the last SAVED value", async () => {
    const write = vi.fn().mockRejectedValue(refused());
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    await tick(400);
    click("settings:blocks.save.discard");
    expect(screen.getByTestId("shown")).toHaveTextContent("kg");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // And nothing is sent in its name later.
    await tick(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("Erneut versuchen sends the same choice again and clears the warning on success", async () => {
    const write = vi.fn().mockRejectedValueOnce(refused()).mockResolvedValue(undefined);
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    await tick(400);
    click("settings:blocks.save.retry");
    await tick(0);
    expect(write).toHaveBeenLastCalledWith("lb", { keepalive: false });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("settings:blocks.save.saved")).toBeInTheDocument();
  });

  it("names the reason: offline, demo and the writer's own", async () => {
    const offline = vi.fn().mockRejectedValue(new Error("Network Error"));
    const { unmount } = render(<Row saved="kg" write={offline} />);
    click("pick lb");
    await tick(400);
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    unmount();
    act(() => resetWriteQueue());

    const zone = vi.fn().mockRejectedValue(new SettingWriteError("timezone"));
    render(<Row saved="kg" write={zone} />);
    click("pick lb");
    await tick(400);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("sends a newer choice after the one in flight, never before", async () => {
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const write = vi.fn((value: string) => {
      order.push(value);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    await tick(400);
    click("pick kg");
    await tick(400);
    expect(order).toEqual(["lb"]);
    await act(async () => finish());
    await tick(0);
    expect(order).toEqual(["lb", "kg"]);
  });
});

describe("leaving the page flushes immediate writes", () => {
  it("sends a waiting write when the row unmounts (router navigation)", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<Row saved="kg" write={write} />);
    click("pick lb");
    expect(write).not.toHaveBeenCalled();
    unmount();
    expect(write).toHaveBeenCalledWith("lb", { keepalive: false });
  });

  it("sends a waiting write on pagehide, with keepalive", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(write).toHaveBeenCalledWith("lb", { keepalive: true });
  });

  it("flushes every setting's waiting write, not only one", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    function Two(): JSX.Element {
      const x = useSettingWrite<string>("a", "1", a);
      const y = useSettingWrite<string>("b", "1", b);
      return (
        <button
          onClick={() => {
            x.choose("2");
            y.choose("2");
          }}
        >
          both
        </button>
      );
    }
    render(<Two />);
    click("both");
    await act(async () => flushWrites(false));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("does not write at all when the choice went back to the saved value", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    render(<Row saved="kg" write={write} />);
    click("pick lb");
    click("pick kg");
    await tick(1000);
    expect(write).not.toHaveBeenCalled();
  });
});
