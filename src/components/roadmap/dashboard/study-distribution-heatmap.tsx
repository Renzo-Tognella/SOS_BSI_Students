"use client";

import type { DashboardVisualModel } from "@/types/dashboard";

interface StudyDistributionHeatmapProps {
  model: DashboardVisualModel;
}

function intensityClass(intensity: number): string {
  if (intensity <= 0) return "heatmap-cell-0";
  if (intensity === 1) return "heatmap-cell-1";
  if (intensity === 2) return "heatmap-cell-2";
  if (intensity === 3) return "heatmap-cell-3";
  return "heatmap-cell-4";
}

export function StudyDistributionHeatmap({ model }: StudyDistributionHeatmapProps) {
  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Study Distribution</h3>
      </header>

      <div className="study-heatmap-grid" role="img" aria-label="Distribuição de horas estudadas por dia da semana">
        {model.studyDistribution.map((cell) => (
          <article className="study-heatmap-item" key={cell.day}>
            <span className={`study-heatmap-cell ${intensityClass(cell.intensity)}`} />
            <p>{cell.day}</p>
            <small>{cell.hours}h</small>
          </article>
        ))}
      </div>
    </section>
  );
}
