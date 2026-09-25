import { motion } from "framer-motion";
import type { Transition } from "framer-motion";
import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Opacity only, and briefly.
 *
 * It used to slide as well — in at y:8, out at y:-8 — and because
 * `AnimatePresence mode="wait"` runs the exit BEFORE the enter, every
 * navigation was 8px up, a pause, then 8px down over 0.36s in total. A
 * tester read that as the page jumping, and as the app being slower than it
 * is: "es fühlt sich dadurch auch etwas langsamer an als wenns einfach ein
 * harter cut wäre" (Alex, 2026-09-20). Motion that reports a speed the app
 * does not have is worse than no motion.
 *
 * A cross-fade at half the duration keeps the one thing the transition is
 * for — you can see that the content changed — and drops the part that only
 * described the change as slow.
 */
const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const pageTransition: Transition = {
  duration: 0.09,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export default function PageTransition({ children }: PageTransitionProps): JSX.Element {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
      style={{ minHeight: "100%" }}
    >
      {children}
    </motion.div>
  );
}
