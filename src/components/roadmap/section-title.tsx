import type { ReactNode } from "react";

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function SectionTitle({ title, subtitle, rightSlot }: SectionTitleProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {rightSlot ?? null}
    </div>
  );
}
