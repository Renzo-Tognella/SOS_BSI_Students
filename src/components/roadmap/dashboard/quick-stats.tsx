"use client";

import { Clock3, GraduationCap, Gauge, Trophy } from "lucide-react";

import type { DashboardVisualModel } from "@/types/dashboard";

interface QuickStatsProps {
  model: DashboardVisualModel;
}

export function QuickStats({ model }: QuickStatsProps) {
  const averageBadge =
    model.averageGrade === null
      ? "-"
      : `${model.averageGrade.toFixed(2)} ${model.averageGradeDelta >= 0 ? "↑" : "↓"} ${Math.abs(model.averageGradeDelta).toFixed(2)}`;

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Quick Stats</h3>
      </header>

      <div className="quick-stats-grid">
        <article className="quick-stat-item">
          <p className="quick-stat-label">
            <Gauge className="h-4 w-4" />
            Média geral
          </p>
          <p className="quick-stat-value">{averageBadge}</p>
        </article>

        <article className="quick-stat-item">
          <p className="quick-stat-label">
            <GraduationCap className="h-4 w-4" />
            Matérias concluídas
          </p>
          <p className="quick-stat-value">
            {model.completedSubjects}/{model.totalSubjects}
          </p>
        </article>

        <article className="quick-stat-item">
          <p className="quick-stat-label">
            <Clock3 className="h-4 w-4" />
            Horas acumuladas
          </p>
          <p className="quick-stat-value">{model.totalStudyHours}h</p>
        </article>

        <article className="quick-stat-item">
          <p className="quick-stat-label">
            <Trophy className="h-4 w-4" />
            Ranking turma
          </p>
          <p className="quick-stat-value">{model.rankingLabel}</p>
        </article>
      </div>
    </section>
  );
}
