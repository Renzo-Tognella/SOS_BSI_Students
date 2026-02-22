import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface GraphSectionProps {
  visible: boolean;
}

export function GraphSection({ children, visible }: PropsWithChildren<GraphSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
