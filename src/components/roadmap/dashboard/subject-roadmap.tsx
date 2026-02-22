"use client";

import { CheckCircle2, Lock, PlayCircle } from "lucide-react";

import type { SubjectRoadmapItem } from "@/types/dashboard";

interface SubjectRoadmapProps {
  items: SubjectRoadmapItem[];
  focusMode: boolean;
  focusedCode: string | null;
  onFocus: (code: string) => void;
}

function stateClass(state: SubjectRoadmapItem["state"]): string {
  if (state === "COMPLETED") return "subject-card-completed";
  if (state === "AVAILABLE") return "subject-card-available";
  if (state === "IN_PROGRESS") return "subject-card-progress";
  return "subject-card-locked";
}

function stateBadge(state: SubjectRoadmapItem["state"]): string {
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "IN_PROGRESS") return "EM ANDAMENTO";
  if (state === "AVAILABLE") return "DISPONÍVEL";
  return "BLOQUEADA";
}

function sparklinePath(scores: number[]): string {
  if (scores.length === 0) {
    return "";
  }

  const width = 80;
  const height = 26;
  const max = Math.max(...scores, 10);
  const min = Math.min(...scores, 0);

  return scores
    .map((value, index) => {
      const x = (index / Math.max(scores.length - 1, 1)) * width;
      const normalized = max === min ? 0.5 : (value - min) / (max - min);
      const y = height - normalized * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function SubjectRoadmap({ items, focusMode, focusedCode, onFocus }: SubjectRoadmapProps) {
  if (items.length === 0) {
    return (
      <section className="dashboard-card">
        <header className="dashboard-card-header">
          <h3>Subject Roadmap</h3>
        </header>
        <p className="empty-copy">Sem disciplinas para exibir no roadmap.</p>
      </section>
    );
  }

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Subject Roadmap</h3>
      </header>

      <div className="subject-roadmap-grid" role="list" aria-label="Roadmap visual de disciplinas">
        {items.map((item) => {
          const dimmed = focusMode && focusedCode && item.code !== focusedCode;

          return (
            <article
              className={`subject-card ${stateClass(item.state)} ${dimmed ? "subject-card-dimmed" : ""}`}
              key={item.code}
              onClick={() => onFocus(item.code)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onFocus(item.code);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="subject-card-head">
                <div>
                  <p className="subject-card-code">{item.code}</p>
                  <p className="subject-card-name">{item.name}</p>
                </div>

                <span className="subject-card-status">
                  {item.state === "COMPLETED" ? <CheckCircle2 className="h-4 w-4" /> : null}
                  {item.state === "AVAILABLE" ? <PlayCircle className="h-4 w-4" /> : null}
                  {item.state === "LOCKED" ? <Lock className="h-4 w-4" /> : null}
                  {stateBadge(item.state)}
                </span>
              </div>

              <p className="subject-card-meta">
                {item.cht} CHT · {item.period ? `${item.period}º período` : "Período livre"}
              </p>

              <div className="subject-card-progress-track">
                <span
                  className="subject-card-progress-fill"
                  style={{
                    width: `${item.completionPercent}%`
                  }}
                />
              </div>

              <div className="subject-card-footer">
                <p>{item.prerequisites.length > 0 ? `Pré: ${item.prerequisites.join(", ")}` : "Sem pré-requisito"}</p>
                <p>{typeof item.grade === "number" ? `Nota atual ${item.grade.toFixed(1)}` : "Sem avaliação"}</p>
              </div>

              <div className="subject-card-sparkline">
                {item.recentScores.length > 0 ? (
                  <svg height="28" viewBox="0 0 80 28" width="80" aria-hidden>
                    <polyline
                      fill="none"
                      points={sparklinePath(item.recentScores)}
                      stroke="var(--accent)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  <span>Sem histórico de notas</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
