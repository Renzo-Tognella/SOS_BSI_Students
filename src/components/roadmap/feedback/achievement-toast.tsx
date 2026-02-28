"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Award } from "lucide-react";

interface AchievementToastProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
}

export function AchievementToast({ open, title, description, onClose }: AchievementToastProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          animate={{ opacity: 1, y: 0 }}
          className="achievement-toast"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          onAnimationComplete={() => {
            window.setTimeout(onClose, 2400);
          }}
          role="status"
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          <Award className="h-5 w-5 text-[var(--accent)]" />
          <div>
            <p>{title}</p>
            <small>{description}</small>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
