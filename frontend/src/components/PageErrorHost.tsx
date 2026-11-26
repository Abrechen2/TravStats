import { useEffect } from "react";
import type { JSX } from "react";
import { useLocation } from "react-router-dom";
import Banner from "./ui/Banner";
import { usePageErrorStore } from "../store/pageErrorStore";

/** Renders `reportPageError` failures as banners at the top of the page. */
export default function PageErrorHost(): JSX.Element | null {
  const errors = usePageErrorStore((s) => s.errors);
  const dismiss = usePageErrorStore((s) => s.dismiss);
  const clear = usePageErrorStore((s) => s.clear);
  const { pathname } = useLocation();
  // A failure belongs to the page it happened on.
  useEffect(() => clear, [pathname, clear]);
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 pt-3" data-testid="page-errors">
      {errors.map((e) => (
        <Banner key={e.id} tone={e.tone} onDismiss={() => dismiss(e.id)}>
          {e.message}
        </Banner>
      ))}
    </div>
  );
}
