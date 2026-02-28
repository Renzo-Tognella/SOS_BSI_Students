"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  BarChart3,
  FileCheck2,
  FileSearch2,
  GitBranch,
  LayoutDashboard,
  Route,
  UploadCloud
} from "lucide-react";

import { ROADMAP_NAV_ITEMS, type RoadmapSectionKey } from "@/components/roadmap/layout/nav-config";

interface RoadmapSidebarProps {
  currentSection: RoadmapSectionKey;
}

const itemIconBySection: Record<RoadmapSectionKey, ComponentType<{ className?: string }>> = {
  upload: UploadCloud,
  review: FileSearch2,
  dashboard: LayoutDashboard,
  graph: GitBranch,
  planner: Route,
  unused: FileCheck2
};

export function RoadmapSidebar({ currentSection }: RoadmapSidebarProps) {
  return (
    <aside className="roadmap-sidebar hidden xl:flex" aria-label="Navegação principal do roadmap">
      <div className="roadmap-sidebar-brand">
        <BarChart3 className="h-5 w-5 text-[var(--primary)]" />
        <div>
          <p className="roadmap-sidebar-title">SaveStudents</p>
          <p className="roadmap-sidebar-subtitle">Roadmap Acadêmico UTFPR</p>
        </div>
      </div>

      <nav className="roadmap-sidebar-nav">
        {ROADMAP_NAV_ITEMS.map((item) => {
          const Icon = itemIconBySection[item.key];
          const active = item.key === currentSection;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`roadmap-sidebar-link ${active ? "roadmap-sidebar-link-active" : ""}`}
              href={item.href}
              key={item.key}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
