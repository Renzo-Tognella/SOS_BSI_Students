import type { ReactNode } from "react";

interface PeriodDropLaneProps {
  title: string;
  subtitle: string;
  selected?: boolean;
  onSelect?: () => void;
  onDropCode?: (code: string) => void;
  children?: ReactNode;
}

export function PeriodDropLane({ title, subtitle, selected, onSelect, onDropCode, children }: PeriodDropLaneProps) {
  return (
    <section
      className={`period-drop-lane ${selected ? "period-drop-lane-selected" : ""}`}
      onClick={onSelect}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const code = event.dataTransfer.getData("text/plain");
        if (code) {
          onDropCode?.(code);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="period-drop-lane-head">
        <h4>{title}</h4>
        <p>{subtitle}</p>
      </div>
      <div className="period-drop-lane-content">{children}</div>
    </section>
  );
}

