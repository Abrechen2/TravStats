import { useCallback, useRef, useState, type ReactNode } from "react";
import type { ServiceDisclosure, UseConfirmation } from "../../lib/api/serviceUse";
import ServiceUseConfirmDialog from "./ServiceUseConfirmDialog";

/**
 * The confirmation dialog as a promise: `ask(disclosure)` opens it and
 * resolves with the person's answer (null for "Abbrechen" or closing).
 * `dialog` is rendered by the caller wherever it keeps its other dialogs.
 * Pass `ask` to `withUseConsent`.
 */
export function useServiceUseConfirm(): {
  ask: (disclosure: ServiceDisclosure) => Promise<UseConfirmation | null>;
  dialog: ReactNode;
} {
  const [disclosure, setDisclosure] = useState<ServiceDisclosure | null>(null);
  const resolver = useRef<((answer: UseConfirmation | null) => void) | null>(null);
  const ask = useCallback(
    (d: ServiceDisclosure) =>
      new Promise<UseConfirmation | null>((resolve) => {
        // A dialog left open by an earlier ask counts as cancelled.
        resolver.current?.(null);
        resolver.current = resolve;
        setDisclosure(d);
      }),
    []
  );
  const decide = (answer: UseConfirmation | null) => {
    resolver.current?.(answer);
    resolver.current = null;
    setDisclosure(null);
  };
  return {
    ask,
    dialog: disclosure ? (
      <ServiceUseConfirmDialog disclosure={disclosure} onDecide={decide} />
    ) : null,
  };
}
