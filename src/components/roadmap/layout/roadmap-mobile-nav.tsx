"use client";

import Link from "next/link";
import { CalendarDays, GitFork, LayoutDashboard, UserRound } from "lucide-react";

import {
  ROADMAP_MOBILE_NAV_ITEMS,
  type RoadmapSectionKey
} from "@/components/roadmap/layout/nav-config";

interface RoadmapMobileNavProps {
  currentSection: RoadmapSectionKey;
}

const mobileItemIcon = {
  dashboard: LayoutDashboard,
  graph: GitFork,
  planner: CalendarDays,
  review: UserRound
} as const;

export function RoadmapMobileNav({ currentSection }: RoadmapMobileNavProps) {
  return (
    <nav className="roadmap-mobile-nav xl:hidden" aria-label="Navegação mobile">
      {ROADMAP_MOBILE_NAV_ITEMS.map((item) => {
        const Icon = mobileItemIcon[item.key as keyof typeof mobileItemIcon] ?? LayoutDashboard;
        const active = item.key === currentSection;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`roadmap-mobile-link ${active ? "roadmap-mobile-link-active" : ""}`}
            href={item.href}
            key={item.key}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
