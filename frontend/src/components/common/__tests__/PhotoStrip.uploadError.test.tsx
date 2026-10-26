import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PhotoStrip, type StripPhoto } from "../PhotoStrip";

/**
 * A refused upload must reach the reader as itself. Beta.29 UAT: a text file
 * picked in a visit's "+ Foto" came back 400 "Invalid image type", and the
 * strip — inside the visit editor — showed nothing at all.
 */
function renderStrip(onUpload: (files: File[]) => Promise<StripPhoto[]>) {
  const { container } = render(
    <PhotoStrip<StripPhoto>
      photos={[]}
      context="test"
      onUpload={onUpload}
      onDelete={vi.fn()}
      onCaption={vi.fn()}
    />
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
  });
}

const refused = (data: Record<string, unknown>) =>
  Object.assign(new Error("400"), { response: { status: 400, data } });

describe("PhotoStrip upload failure", () => {
  it("says beside the button that the file is not a photo", async () => {
    renderStrip(() =>
      Promise.reject(
        refused({
          error: "Invalid image type. Allowed: image/jpeg",
          code: "UNSUPPORTED_UPLOAD_TYPE",
        })
      )
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("places:photos.unsupportedType");
    expect(alert).not.toHaveTextContent("Invalid image type");
  });

  it("names any other refusal as a failed upload, never the server's prose", async () => {
    renderStrip(() => Promise.reject(refused({ error: "boom" })));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("places:photos.uploadFailed");
    expect(alert).not.toHaveTextContent("boom");
  });
});
