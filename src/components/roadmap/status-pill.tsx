import type { ReactNode } from "react";

interface StatusPillProps {
  variant: "done" | "available" | "blocked" | "failed" | "neutral";
  children: ReactNode;
}

function classByVariant(variant: StatusPillProps["variant"]): string {
  if (variant === "done") return "status-pill status-pill-done";
  if (variant === "available") return "status-pill status-pill-available";
  if (variant === "blocked") return "status-pill status-pill-blocked";
  if (variant === "failed") return "status-pill status-pill-failed";
  return "status-pill status-pill-neutral";
}

export function StatusPill({ variant, children }: { variant: StatusPillProps["variant"]; children: ReactNode }) {
  return <span className={classByVariant(variant)}>{children}</span>;
}
