import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface PlannerSectionProps {
  visible: boolean;
  className?: string;
}

export function PlannerSection({ children, className, visible }: PropsWithChildren<PlannerSectionProps>) {
  return (
    <SectionFrame className={className} visible={visible}>
      {children}
    </SectionFrame>
  );
}
