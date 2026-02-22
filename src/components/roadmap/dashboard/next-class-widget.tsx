"use client";

import { CalendarClock, DownloadCloud, Video } from "lucide-react";

import { formatEventDate } from "@/lib/domain/dashboard-visual-mappers";
import type { DashboardVisualModel } from "@/types/dashboard";

interface NextClassWidgetProps {
  model: DashboardVisualModel;
}

export function NextClassWidget({ model }: NextClassWidgetProps) {
  if (!model.nextClass) {
    return (
      <section className="dashboard-card">
        <header className="dashboard-card-header">
          <h3>Próxima Aula</h3>
        </header>
        <p className="empty-copy">Sem aulas com horário definido no plano atual.</p>
      </section>
    );
  }

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Próxima Aula</h3>
      </header>

      <div className="next-class-card">
        <p className="next-class-title">{model.nextClass.title}</p>
        <p className="next-class-subtitle">{model.nextClass.subtitle}</p>

        <div className="next-class-meta">
          <span>
            <CalendarClock className="h-4 w-4" />
            {formatEventDate(model.nextClass.startsAt)}
          </span>
          <span>{model.nextClass.countdownLabel}</span>
        </div>

        <div className="next-class-meta">
          <span>
            <DownloadCloud className="h-4 w-4" />
            {model.nextClass.materialCount} material(is)
          </span>
          <span>{model.nextClass.online ? "Online" : "Presencial"}</span>
        </div>

        <button className="next-class-action" type="button">
          <Video className="h-4 w-4" />
          Entrar na sala
        </button>
      </div>
    </section>
  );
}
