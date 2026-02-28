import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface ManualCorrelationSectionProps {
  visible: boolean;
}

export function ManualCorrelationSection({ children, visible }: PropsWithChildren<ManualCorrelationSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
