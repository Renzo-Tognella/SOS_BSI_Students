interface WeeklyAgendaEntry {
  code: string;
  name: string;
  turma?: string;
  horario: string;
  sala?: string;
}

interface WeeklyAgendaBoardProps {
  entries: WeeklyAgendaEntry[];
}

const DAY_COLUMNS = [
  { key: "2", label: "Segunda" },
  { key: "3", label: "Terça" },
  { key: "4", label: "Quarta" },
  { key: "5", label: "Quinta" },
  { key: "6", label: "Sexta" },
  { key: "7", label: "Sábado" }
] as const;

const SLOT_ROWS = [
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "M6",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6"
] as const;

function parseHorarioCode(code: string): { dayKey: string; slot: string } | null {
  const match = code.trim().toUpperCase().match(/^([2-7])([MTN])(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    dayKey: match[1],
    slot: `${match[2]}${match[3]}`
  };
}

function cardToneClass(code: string): string {
  let hash = 0;
  for (let index = 0; index < code.length; index += 1) {
    hash = (hash + code.charCodeAt(index) * (index + 1)) % 4;
  }

  if (hash === 0) return "weekly-agenda-card-a";
  if (hash === 1) return "weekly-agenda-card-b";
  if (hash === 2) return "weekly-agenda-card-c";
  return "weekly-agenda-card-d";
}

export function WeeklyAgendaBoard({ entries }: WeeklyAgendaBoardProps) {
  const validEntries: Array<WeeklyAgendaEntry & { dayKey: string; slot: string }> = [];
  const invalidEntries: WeeklyAgendaEntry[] = [];

  for (const entry of entries) {
    const parsed = parseHorarioCode(entry.horario);
    if (!parsed) {
      invalidEntries.push(entry);
      continue;
    }

    validEntries.push({
      ...entry,
      dayKey: parsed.dayKey,
      slot: parsed.slot
    });
  }

  const cellMap = new Map<string, Array<WeeklyAgendaEntry & { dayKey: string; slot: string }>>();
  for (const entry of validEntries) {
    const key = `${entry.dayKey}-${entry.slot}`;
    const list = cellMap.get(key) ?? [];
    list.push(entry);
    cellMap.set(key, list);
  }

  return (
    <div className="weekly-agenda-board">
      <div className="weekly-agenda-grid">
        <div className="weekly-agenda-corner">Horário</div>
        {DAY_COLUMNS.map((day) => (
          <div className="weekly-agenda-day-header" key={`day-${day.key}`}>
            {day.label}
          </div>
        ))}

        {SLOT_ROWS.map((slot) => (
          <div className="weekly-agenda-row" key={`row-${slot}`}>
            <div className="weekly-agenda-slot-label">{slot}</div>
            {DAY_COLUMNS.map((day) => {
              const cellKey = `${day.key}-${slot}`;
              const cellEntries = cellMap.get(cellKey) ?? [];

              return (
                <div className="weekly-agenda-cell" key={`cell-${cellKey}`}>
                  {cellEntries.map((entry, index) => (
                    <article className={`weekly-agenda-card ${cardToneClass(entry.code)}`} key={`${cellKey}-${entry.code}-${entry.turma ?? "turma"}-${index}`}>
                      <p className="weekly-agenda-card-code">{entry.code}</p>
                      <p className="weekly-agenda-card-name">{entry.name}</p>
                      <p className="weekly-agenda-card-meta">
                        {entry.turma ?? "-"} · {entry.sala ?? "-"}
                      </p>
                    </article>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {invalidEntries.length > 0 ? (
        <div className="weekly-agenda-invalid">
          <p className="weekly-agenda-invalid-title">Horários fora do padrão de grade semanal</p>
          <ul className="weekly-agenda-invalid-list">
            {invalidEntries.map((entry, index) => (
              <li key={`invalid-${entry.code}-${entry.horario}-${index}`}>
                {entry.code} · {entry.name} · {entry.horario}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
