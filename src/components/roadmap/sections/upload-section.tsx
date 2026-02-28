import type { PropsWithChildren } from "react";

import { SectionFrame } from "@/components/roadmap/sections/section-frame";

interface UploadSectionProps {
  visible: boolean;
}

export function UploadSection({ children, visible }: PropsWithChildren<UploadSectionProps>) {
  return <SectionFrame visible={visible}>{children}</SectionFrame>;
}
