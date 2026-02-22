export const ROADMAP_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "planner", label: "Planejamento", href: "/grade" },
  { key: "graph", label: "Grafo", href: "/grafo" },
  { key: "review", label: "Revisão", href: "/revisao" },
  { key: "upload", label: "Upload", href: "/" },
  { key: "unused", label: "Não Utilizadas", href: "/nao-utilizadas" }
] as const;

export type RoadmapSectionKey = (typeof ROADMAP_NAV_ITEMS)[number]["key"];

export interface RoadmapMobileNavItem {
  label: string;
  href: string;
  key: RoadmapSectionKey;
}

export const ROADMAP_MOBILE_NAV_ITEMS: RoadmapMobileNavItem[] = [
  { key: "dashboard", label: "Visão Geral", href: "/dashboard" },
  { key: "graph", label: "Roadmap", href: "/grafo" },
  { key: "planner", label: "Agenda", href: "/grade" },
  { key: "review", label: "Perfil", href: "/revisao" }
];

export function resolveSectionByPathname(pathname: string): RoadmapSectionKey {
  if (pathname === "/" || pathname.startsWith("/upload")) {
    return "upload";
  }

  const matched = ROADMAP_NAV_ITEMS.find((item) => {
    if (item.href === "/") {
      return pathname === "/";
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });

  return matched?.key ?? "upload";
}

export function resolveSectionLabel(section: RoadmapSectionKey): string {
  return ROADMAP_NAV_ITEMS.find((item) => item.key === section)?.label ?? "Upload";
}
