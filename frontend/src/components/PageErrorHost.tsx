import { useEffect } from "react";
import type { JSX } from "react";
import { useLocation } from "react-router-dom";
import Banner from "./ui/Banner";
import { usePageErrorStore } from "../store/pageErrorStore";
import { useDialogStackStore } from "../store/dialogStackStore";

/** The banners themselves — on the page, or inside the top dialog. */
export function PageErrorList({ inDialog = false }: { inDialog?: boolean }): JSX.Element | null {
  const errors = usePageErrorStore((s) => s.errors);
  const dismiss = usePageErrorStore((s) => s.dismiss);
  if (errors.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-2 ${inDialog ? "pb-3" : "px-4 pt-3"}`}
      data-testid={inDialog ? "dialog-errors" : "page-errors"}
    >
      {errors.map((e) => (
        <Banner key={e.id} tone={e.tone} onDismiss={() => dismiss(e.id)}>
          {e.message}
        </Banner>
      ))}
    </div>
  );
}

/** Renders `reportPageError` failures as banners at the top of the page. */
export default function PageErrorHost(): JSX.Element | null {
  const clear = usePageErrorStore((s) => s.clear);
  const dialogOpen = useDialogStackStore((s) => s.open.length > 0);
  const { pathname } = useLocation();
  // A failure belongs to the page it happened on.
  useEffect(() => clear, [pathname, clear]);
  // With a dialog open the dialog shows them (`DialogErrorHost`): a banner
  // behind the scrim would be an error nobody can see.
  if (dialogOpen) return null;
  return <PageErrorList />;
}
