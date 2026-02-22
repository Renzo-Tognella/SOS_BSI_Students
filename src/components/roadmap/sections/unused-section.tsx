import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface UnusedSectionProps {
  visible: boolean;
}

export function UnusedSection({ children, visible }: PropsWithChildren<UnusedSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
