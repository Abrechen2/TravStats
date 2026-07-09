// Defensive error boundary around the pinned-popup card. Without it, a
// throw inside the React subtree mounted via createPortal would bubble
// up and unmount GlobeView itself — the user-observable symptom is
// "the globe disappears completely on click". Catching the throw here
// keeps the canvas alive; the worst case is the popup renders empty.

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { logger } from "../../lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class PinnedCardBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(
      { err: error, componentStack: info.componentStack },
      "globe.pinned-card.render-failed"
    );
  }

  componentDidUpdate(prevProps: Props): void {
    // Reset on prop change so the next click can re-attempt rendering
    // instead of staying in the broken state forever.
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render nothing rather than a fallback message — the popup is
      // optional UI; better to silently swallow than draw something
      // misleading.
      return null;
    }
    return this.props.children;
  }
}
