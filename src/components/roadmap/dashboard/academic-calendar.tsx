"use client";

import { useMemo, useState } from "react";

import { getCalendarMonthMatrix } from "@/lib/domain/dashboard-visual-mappers";

type UtfprEventType = "matricula" | "aulas" | "feriado" | "recesso" | "institucional";

interface UtfprCalendarEvent {
  id: string;
  title: string;
  type: UtfprEventType;
  start: string;
  end?: string;
  note?: string;
}

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
] as const;

const UTFPR_CURITIBA_2026_EVENTS: UtfprCalendarEvent[] = [
  {
    id: "matricula-requerimento-curitiba",
    title: "Requerimento de matrícula (veteranos)",
    type: "matricula",
    start: "2026-02-27T09:00:00-03:00",
    end: "2026-03-02T18:00:00-03:00",
    note: "Curitiba"
  },
  {
    id: "matricula-ajuste-curitiba",
    title: "Confirmação/Ajuste de matrícula",
    type: "matricula",
    start: "2026-03-05T10:00:00-03:00",
    end: "2026-03-05T18:00:00-03:00",
    note: "Curitiba"
  },
  {
    id: "matricula-inclusao-curitiba",
    title: "Inclusão de disciplinas",
    type: "matricula",
    start: "2026-03-06T09:00:00-03:00",
    end: "2026-03-06T18:00:00-03:00",
    note: "Curitiba"
  },
  {
    id: "inicio-aulas-s1",
    title: "Início das aulas - 1º semestre",
    type: "aulas",
    start: "2026-03-10T08:00:00-03:00"
  },
  {
    id: "termino-aulas-s1",
    title: "Término das aulas - 1º semestre",
    type: "aulas",
    start: "2026-07-13T22:00:00-03:00"
  },
  {
    id: "inicio-aulas-s2",
    title: "Início das aulas - 2º semestre",
    type: "aulas",
    start: "2026-08-18T08:00:00-03:00"
  },
  {
    id: "termino-aulas-s2",
    title: "Término das aulas - 2º semestre",
    type: "aulas",
    start: "2026-12-19T22:00:00-03:00"
  },
  {
    id: "feriado-curitiba",
    title: "Padroeira de Curitiba",
    type: "feriado",
    start: "2026-09-08T00:00:00-03:00"
  },
  {
    id: "feriado-carnaval",
    title: "Carnaval",
    type: "feriado",
    start: "2026-02-17T00:00:00-03:00"
  },
  {
    id: "feriado-cinzas",
    title: "Cinzas",
    type: "feriado",
    start: "2026-02-18T00:00:00-03:00"
  },
  {
    id: "feriado-corpus",
    title: "Corpus Christi",
    type: "feriado",
    start: "2026-06-04T00:00:00-03:00"
  },
  {
    id: "feriado-independencia",
    title: "Independência do Brasil",
    type: "feriado",
    start: "2026-09-07T00:00:00-03:00"
  }
];

function formatDateTime(dateIso: string): string {
  const date = new Date(dateIso);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function eventTypeLabel(type: UtfprEventType): string {
  if (type === "matricula") return "Matrícula";
  if (type === "aulas") return "Aulas";
  if (type === "feriado") return "Feriado";
  if (type === "recesso") return "Recesso";
  return "Institucional";
}

function eventTypeDotClass(type: UtfprEventType): string {
  if (type === "matricula") return "bg-[var(--accent)]";
  if (type === "aulas") return "bg-[var(--status-danger)]";
  if (type === "feriado") return "bg-[var(--status-warning)]";
  if (type === "recesso") return "bg-sky-400";
  return "bg-violet-400";
}

function eventBadgeClass(type: UtfprEventType): string {
  if (type === "matricula") return "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]";
  if (type === "aulas") return "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/15 text-rose-300";
  if (type === "feriado") return "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/15 text-amber-200";
  if (type === "recesso") return "border-sky-400/35 bg-sky-400/15 text-sky-200";
  return "border-violet-400/35 bg-violet-400/15 text-violet-200";
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function eventDayKeys(event: UtfprCalendarEvent): string[] {
  const start = new Date(event.start);
  const end = new Date(event.end ?? event.start);

  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  while (cursor.getTime() <= endDay.getTime()) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function eventDateRangeLabel(event: UtfprCalendarEvent): string {
  if (!event.end) {
    return formatDateTime(event.start);
  }

  return `${formatDateTime(event.start)} - ${formatDateTime(event.end)}`;
}

export function AcademicCalendar() {
  const currentMonth = new Date().getMonth();
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getFullYear() === 2026 ? currentMonth : 1);

  const referenceDate = useMemo(() => new Date(2026, selectedMonth, 1), [selectedMonth]);
  const monthMatrix = useMemo(() => getCalendarMonthMatrix(referenceDate), [referenceDate]);

  const eventDays = useMemo(() => {
    const set = new Set<string>();
    for (const event of UTFPR_CURITIBA_2026_EVENTS) {
      for (const key of eventDayKeys(event)) {
        set.add(key);
      }
    }
    return set;
  }, []);

  const monthEvents = useMemo(() => {
    return UTFPR_CURITIBA_2026_EVENTS.filter((event) => {
      const start = new Date(event.start);
      const end = new Date(event.end ?? event.start);
      return start.getMonth() === selectedMonth || end.getMonth() === selectedMonth;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [selectedMonth]);

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <div className="flex items-center gap-2">
          <h3>Calendário Acadêmico 2026</h3>
          <span className="rounded-full border border-[var(--primary)]/35 bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)]">
            UTFPR Curitiba
          </span>
        </div>

        <label className="text-xs text-[var(--text-muted)]" htmlFor="month-select-utfpr-2026">
          Mês
          <select
            className="ml-2 rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-xs text-[var(--text)]"
            id="month-select-utfpr-2026"
            onChange={(event) => setSelectedMonth(Number(event.target.value))}
            value={selectedMonth}
          >
            {MONTH_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="calendar-grid">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, index) => (
          <span className="calendar-weekday" key={`weekday-${label}-${index}`}>
            {label}
          </span>
        ))}

        {monthMatrix.map((date) => {
          const inCurrentMonth = date.getMonth() === selectedMonth;
          const key = dayKey(date);
          const hasEvent = eventDays.has(key);

          return (
            <div
              className={`calendar-day ${inCurrentMonth ? "" : "calendar-day-out"} ${hasEvent ? "calendar-day-event" : ""}`}
              key={key}
            >
              <span>{date.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="calendar-upcoming">
        <h4>Eventos de {MONTH_LABELS[selectedMonth]} / 2026 (Curitiba)</h4>

        {monthEvents.length === 0 ? (
          <p className="empty-copy">Sem eventos mapeados para este mês no calendário institucional.</p>
        ) : (
          <ul>
            {monthEvents.map((event) => (
              <li key={event.id}>
                <div className="calendar-upcoming-main">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${eventTypeDotClass(event.type)}`} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p>{event.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${eventBadgeClass(event.type)}`}>
                        {eventTypeLabel(event.type)}
                      </span>
                    </div>
                    <small>{eventDateRangeLabel(event)}</small>
                    {event.note ? <small className="ml-2">{event.note}</small> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]/70 px-3 py-2 text-[11px] text-[var(--text-muted)]">
          Fonte: calendário letivo UTFPR 2026 e notícia de matrícula 2026.1 (publicada em 28/01/2026), filtrado para campus Curitiba.
        </div>
      </div>
    </section>
  );
}
