import type { PropsWithChildren } from "react";

interface SurfaceCardProps {
  className?: string;
  soft?: boolean;
}

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function SurfaceCard({ children, className, soft = false }: PropsWithChildren<SurfaceCardProps>) {
  return <section className={joinClasses("surface-card", soft && "surface-card-soft", className)}>{children}</section>;
}

