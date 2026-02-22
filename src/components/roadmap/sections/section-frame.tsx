import type { PropsWithChildren } from "react";

interface SectionFrameProps {
  visible: boolean;
  className?: string;
}

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function SectionFrame({ children, className, visible }: PropsWithChildren<SectionFrameProps>) {
  if (!visible) {
    return null;
  }

  return <section className={joinClasses("roadmap-section-card", className)}>{children}</section>;
}
