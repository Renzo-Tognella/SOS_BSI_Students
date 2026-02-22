import { RoadmapShell } from "@/components/roadmap/layout/roadmap-shell";

export default function RoadmapGroupLayout({ children }: { children: React.ReactNode }) {
  return <RoadmapShell>{children}</RoadmapShell>;
}
