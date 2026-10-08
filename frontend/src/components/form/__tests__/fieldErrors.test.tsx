/**
 * forgejo#246: an error belongs at its field, tied to it for a screen reader,
 * and a refused save takes the user to the first one — opening a folded
 * section if that is where it sits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FieldError from "../FieldError";
import FormErrorBanner from "../FormErrorBanner";
import { fieldErrorProps } from "../fieldErrorProps";
import { focusFirstError } from "../focusFirstError";
import { Field, Input } from "../../ui/Field";

afterEach(cleanup);

describe("fieldErrorProps + FieldError", () => {
  it("marks the control invalid and reads the message as its description", () => {
    render(
      <>
        <label htmlFor="stars">Sterne</label>
        <input id="stars" {...fieldErrorProps("stars", "1 bis 5")} />
        <FieldError id="stars" error="1 bis 5" />
      </>
    );
    const input = screen.getByLabelText("Sterne");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("1 bis 5");
    expect(screen.getByRole("alert")).toHaveTextContent("1 bis 5");
  });

  it("keeps a description the control already had, and adds the error to it", () => {
    expect(fieldErrorProps("stars", "1 bis 5", "stars-hint")).toEqual({
      "aria-invalid": true,
      "aria-describedby": "stars-hint stars-error",
    });
    expect(fieldErrorProps("stars", null, "stars-hint")).toEqual({
      "aria-describedby": "stars-hint",
    });
  });

  it("adds nothing for a valid field", () => {
    expect(fieldErrorProps("stars", null)).toEqual({});
    render(<FieldError id="stars" error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ui/Field", () => {
  it("ties its error to the control it labels", () => {
    render(
      <Field label="Name" htmlFor="trip-name" error="Pflichtfeld">
        <Input id="trip-name" aria-describedby="trip-name-hint" />
      </Field>
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("trip-name-hint trip-name-error");
    expect(document.getElementById("trip-name-error")).toHaveTextContent("Pflichtfeld");
  });

  it("leaves a valid control untouched", () => {
    render(
      <Field label="Name" htmlFor="trip-name">
        <Input id="trip-name" />
      </Field>
    );
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("FormErrorBanner", () => {
  it("is announced, and offers a retry only when asked to", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<FormErrorBanner message="Netzwerkfehler" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Netzwerkfehler");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<FormErrorBanner message="Netzwerkfehler" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("focusFirstError", () => {
  it("focuses the first invalid field in reading order, unfolding its section", () => {
    const { container } = render(
      <form>
        <input aria-label="Name" />
        <details>
          <summary>Mehr</summary>
          <input aria-label="Sterne" aria-invalid="true" />
        </details>
        <input aria-label="Website" aria-invalid="true" />
        <FormErrorBanner message="Speichern fehlgeschlagen" />
      </form>
    );
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const target = focusFirstError(container as HTMLElement);
    expect(target).toBe(screen.getByLabelText("Sterne"));
    expect(document.activeElement).toBe(target);
    expect(container.querySelector("details")?.open).toBe(true);
    expect(scroll).toHaveBeenCalled();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("falls back to the banner when no field is at fault", () => {
    const { container } = render(
      <form>
        <input aria-label="Name" />
        <FormErrorBanner message="Speichern fehlgeschlagen" />
      </form>
    );
    expect(focusFirstError(container as HTMLElement)).toBe(screen.getByRole("alert"));
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("returns null when there is nothing wrong", () => {
    const { container } = render(<input aria-label="Name" />);
    expect(focusFirstError(container as HTMLElement)).toBeNull();
  });
});
