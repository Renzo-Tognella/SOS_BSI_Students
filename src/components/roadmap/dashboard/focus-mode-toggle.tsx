"use client";

import { Eye, EyeOff } from "lucide-react";

interface FocusModeToggleProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}

export function FocusModeToggle({ enabled, onToggle }: FocusModeToggleProps) {
  return (
    <button
      aria-pressed={enabled}
      className={`focus-toggle ${enabled ? "focus-toggle-enabled" : ""}`}
      onClick={() => onToggle(!enabled)}
      type="button"
    >
      {enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      <span>{enabled ? "Focus Mode ligado" : "Focus Mode"}</span>
    </button>
  );
}
