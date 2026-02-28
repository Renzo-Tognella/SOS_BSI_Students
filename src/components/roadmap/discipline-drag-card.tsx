interface DisciplineDragCardProps {
  code: string;
  name: string;
  cht: number;
  chs: number;
  draggable?: boolean;
  compact?: boolean;
  onDragStart?: (code: string) => void;
  onRemove?: (code: string) => void;
}

export function DisciplineDragCard({
  code,
  name,
  cht,
  chs,
  draggable = false,
  compact = false,
  onDragStart,
  onRemove
}: DisciplineDragCardProps) {
  return (
    <article
      className={`discipline-drag-card ${compact ? "discipline-drag-card-compact" : ""}`}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", code);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.(code);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="discipline-drag-code">{code}</p>
        {onRemove ? (
          <button className="discipline-remove-btn" onClick={() => onRemove(code)} type="button">
            remover
          </button>
        ) : null}
      </div>
      <p className="discipline-drag-name">{name}</p>
      <p className="discipline-drag-meta">
        {chs} CHS · {cht} CHT
      </p>
    </article>
  );
}

