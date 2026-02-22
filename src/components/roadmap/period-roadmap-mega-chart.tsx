"use client";

import { useMemo, type CSSProperties } from "react";
import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";

export interface PeriodRoadmapCategoryMeta {
  key: string;
  label: string;
  color: string;
}

export interface PeriodRoadmapSectorProgress {
  key: string;
  label: string;
  color: string;
  totalCHT: number;
  doneCHT: number;
  missingCHT: number;
  completionPercent: number;
  disciplinesTotal: number;
  disciplinesDone: number;
}

export interface PeriodRoadmapProgress {
  period: number;
  totalCHT: number;
  doneCHT: number;
  missingCHT: number;
  completionPercent: number;
  disciplinesTotal: number;
  disciplinesDone: number;
  sectors: PeriodRoadmapSectorProgress[];
}

interface PeriodRoadmapMegaChartProps {
  periods: PeriodRoadmapProgress[];
  categories: PeriodRoadmapCategoryMeta[];
}

const periodChartOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        color: "#d6e2f7",
        usePointStyle: true,
        boxHeight: 8,
        boxWidth: 8
      }
    },
    tooltip: {
      callbacks: {
        label(context) {
          const value = Number(context.raw ?? 0);
          return `${context.dataset.label}: ${value} CHT`;
        }
      }
    }
  },
  scales: {
    x: {
      stacked: true,
      ticks: { color: "#9eb0cd" },
      grid: { color: "rgba(35, 50, 79, 0.35)" }
    },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { color: "#9eb0cd" },
      grid: { color: "rgba(35, 50, 79, 0.35)" }
    }
  }
};

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function completionCellStyle(percent: number): CSSProperties {
  const alpha = 0.14 + Math.min(Math.max(percent, 0), 100) / 100 * 0.42;
  if (percent >= 100) {
    return { backgroundColor: `rgba(74, 216, 157, ${alpha})`, color: "#7df0bd" };
  }
  if (percent >= 70) {
    return { backgroundColor: `rgba(106, 124, 255, ${alpha})`, color: "#b6c2ff" };
  }
  if (percent >= 40) {
    return { backgroundColor: `rgba(255, 182, 92, ${alpha})`, color: "#ffd6a0" };
  }
  return { backgroundColor: `rgba(255, 111, 145, ${alpha})`, color: "#ffb5c7" };
}

export function PeriodRoadmapMegaChart({ periods, categories }: PeriodRoadmapMegaChartProps) {
  const overall = useMemo(() => {
    const totalCHT = periods.reduce((sum, period) => sum + period.totalCHT, 0);
    const doneCHT = periods.reduce((sum, period) => sum + period.doneCHT, 0);
    return {
      totalCHT,
      doneCHT,
      missingCHT: Math.max(totalCHT - doneCHT, 0),
      completionPercent: totalCHT > 0 ? (doneCHT / totalCHT) * 100 : 0
    };
  }, [periods]);

  const chartData = useMemo<ChartData<"bar">>(() => {
    return {
      labels: periods.map((period) => `${period.period}º período`),
      datasets: [
        {
          label: "CHT concluída",
          data: periods.map((period) => period.doneCHT),
          backgroundColor: "rgba(74, 216, 157, 0.82)",
          borderColor: "rgba(74, 216, 157, 1)",
          borderWidth: 1,
          borderRadius: 10,
          borderSkipped: false
        },
        {
          label: "CHT faltante",
          data: periods.map((period) => period.missingCHT),
          backgroundColor: "rgba(106, 124, 255, 0.45)",
          borderColor: "rgba(106, 124, 255, 0.8)",
          borderWidth: 1,
          borderRadius: 10,
          borderSkipped: false
        }
      ]
    };
  }, [periods]);

  if (periods.length === 0) {
    return (
      <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
        <h3 className="text-base font-bold text-slate-100">Roadmap Gigante por Período</h3>
        <p className="mt-2 text-sm text-slate-400">Sem dados por período para exibir.</p>
      </article>
    );
  }

  return (
    <article className="roadmap-mega">
      <div className="roadmap-mega-head">
        <div>
          <h3 className="roadmap-mega-title">Roadmap por Período</h3>
          <p className="roadmap-mega-subtitle">Cada período mostra seções necessárias e percentual já cumprido.</p>
        </div>
        <div className="roadmap-mega-metrics">
          <span>
            Concluído: <strong>{overall.doneCHT} CHT</strong>
          </span>
          <span>
            Faltante: <strong>{overall.missingCHT} CHT</strong>
          </span>
          <span>
            Progresso total: <strong>{formatPercent(overall.completionPercent)}</strong>
          </span>
        </div>
      </div>

      <div className="roadmap-mega-chart">
        <Bar data={chartData} options={periodChartOptions} />
      </div>

      <div className="roadmap-mega-cards">
        {periods.map((period) => (
          <article className="roadmap-period-card" key={`roadmap-period-${period.period}`}>
            <div className="roadmap-period-card-head">
              <div>
                <p className="roadmap-period-label">{period.period}º período</p>
                <p className="roadmap-period-meta">
                  {period.disciplinesDone}/{period.disciplinesTotal} disciplinas
                </p>
              </div>
              <div
                className="roadmap-period-ring"
                style={{
                  background: `conic-gradient(${period.completionPercent >= 100 ? "#4ad89d" : "#6a7cff"} ${Math.max(
                    period.completionPercent,
                    1
                  )}%, rgba(35, 50, 79, 0.85) 0)`
                }}
              >
                <div className="roadmap-period-ring-inner">{formatPercent(period.completionPercent)}</div>
              </div>
            </div>

            <p className="roadmap-period-cht">
              {period.doneCHT}/{period.totalCHT} CHT concluída
            </p>

            <div className="roadmap-period-sectors">
              {period.sectors
                .filter((sector) => sector.totalCHT > 0)
                .map((sector) => (
                  <div className="roadmap-period-sector" key={`roadmap-period-${period.period}-${sector.key}`}>
                    <div className="roadmap-period-sector-top">
                      <span className="roadmap-period-sector-name">
                        <span className="roadmap-period-sector-dot" style={{ backgroundColor: sector.color }} />
                        {sector.label}
                      </span>
                      <span className="roadmap-period-sector-percent">{formatPercent(sector.completionPercent)}</span>
                    </div>
                    <div className="roadmap-period-sector-track">
                      <span
                        className="roadmap-period-sector-fill"
                        style={{
                          width: `${Math.min(Math.max(sector.completionPercent, 0), 100)}%`,
                          background: `linear-gradient(90deg, ${sector.color} 0%, rgba(255,255,255,0.55) 180%)`
                        }}
                      />
                    </div>
                    <p className="roadmap-period-sector-meta">
                      {sector.doneCHT}/{sector.totalCHT} CHT
                    </p>
                  </div>
                ))}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Seção</th>
              {periods.map((period) => (
                <th key={`period-head-${period.period}`}>{period.period}º</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={`heat-row-${category.key}`}>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                    {category.label}
                  </span>
                </td>
                {periods.map((period) => {
                  const sector = period.sectors.find((item) => item.key === category.key);
                  if (!sector || sector.totalCHT <= 0) {
                    return <td key={`heat-${category.key}-${period.period}`}>-</td>;
                  }

                  return (
                    <td key={`heat-${category.key}-${period.period}`}>
                      <span
                        className="inline-flex w-full items-center justify-center rounded-md px-2 py-1 text-xs font-semibold"
                        style={completionCellStyle(sector.completionPercent)}
                      >
                        {formatPercent(sector.completionPercent)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
