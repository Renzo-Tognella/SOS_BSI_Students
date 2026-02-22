import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface ReviewSectionProps {
  visible: boolean;
}

export function ReviewSection({ children, visible }: PropsWithChildren<ReviewSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
