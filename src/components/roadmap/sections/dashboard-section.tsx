import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface DashboardSectionProps {
  visible: boolean;
}

export function DashboardSection({ children, visible }: PropsWithChildren<DashboardSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
