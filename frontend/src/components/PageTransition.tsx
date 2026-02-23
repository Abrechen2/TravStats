import { motion } from "framer-motion";
import type { Transition } from "framer-motion";
import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransition: Transition = {
  duration: 0.18,
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
