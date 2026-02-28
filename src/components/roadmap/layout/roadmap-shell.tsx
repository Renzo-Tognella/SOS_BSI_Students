"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import {
  resolveSectionByPathname,
  resolveSectionLabel,
  type RoadmapSectionKey
} from "@/components/roadmap/layout/nav-config";
import { RoadmapMobileNav } from "@/components/roadmap/layout/roadmap-mobile-nav";
import { RoadmapSidebar } from "@/components/roadmap/layout/roadmap-sidebar";
import { RoadmapTopbar } from "@/components/roadmap/layout/roadmap-topbar";

export function RoadmapShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const currentSection = useMemo<RoadmapSectionKey>(() => resolveSectionByPathname(pathname), [pathname]);
  const sectionLabel = useMemo(() => resolveSectionLabel(currentSection), [currentSection]);

  return (
    <div className="roadmap-shell-bg">
      <div className="roadmap-shell-grid">
        <RoadmapSidebar currentSection={currentSection} />

        <div className="roadmap-shell-main">
          <RoadmapTopbar sectionLabel={sectionLabel} />

          <div className="roadmap-shell-content">{children}</div>
        </div>
      </div>

      <RoadmapMobileNav currentSection={currentSection} />
    </div>
  );
}
