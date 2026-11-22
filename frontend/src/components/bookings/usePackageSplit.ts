import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { OverflowEntry } from "../ui/OverflowMenu";

/** Lets a host entry's ⋯ menu open the package card's split dialog (owner, 2026-11-22). */
export interface PackageSplitController {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Called by the card once it knows whether the booking can be split at all. */
  report: (canSplit: boolean) => void;
}

/**
 * The state a host shares with its `PackageBookingCard`, and the "Paketpreis aufteilen …" menu
 * entry — `null` until the card has found a splittable package, so a single booking never
 * offers an action that has nothing to do.
 */
export function usePackageSplit(): {
  controller: PackageSplitController;
  entry: OverflowEntry | null;
} {
  const { t } = useTranslation("trips");
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const report = useCallback((can: boolean) => setAvailable(can), []);
  const controller = useMemo(() => ({ open, setOpen, report }), [open, report]);
  const entry: OverflowEntry | null = available
    ? {
        key: "package-split",
        testId: "package-split-menu",
        label: t("bookingPackage.splitMenu"),
        onSelect: () => setOpen(true),
      }
    : null;
  return { controller, entry };
}
