import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BackupDeleteModal from "../BackupDeleteModal";
import type { Backup } from "../backupTypes";

describe("backup deletion scope", () => {
  const backup = { syncedToCloud: true, cloudTarget: "recorded" } as Backup;
  it("defaults to keeping the remote copy", () => {
    const confirm = vi.fn();
    render(
      <BackupDeleteModal backup={backup} busy={false} onClose={vi.fn()} onConfirm={confirm} />
    );
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    expect(confirm).toHaveBeenCalledWith(false);
  });
  it("sends the explicit remote choice", () => {
    const confirm = vi.fn();
    render(
      <BackupDeleteModal backup={backup} busy={false} onClose={vi.fn()} onConfirm={confirm} />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    expect(confirm).toHaveBeenCalledWith(true);
  });
});
