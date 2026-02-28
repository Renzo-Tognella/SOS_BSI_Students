"use client";

import { motion } from "framer-motion";
import { Flame, Target } from "lucide-react";

import type { DashboardVisualModel } from "@/types/dashboard";

interface CourseAtmosphereProps {
  model: DashboardVisualModel;
}

export function CourseAtmosphere({ model }: CourseAtmosphereProps) {
  const progress = Math.max(0, Math.min(model.overallProgressPercent, 100));

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="dashboard-card course-atmosphere"
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <div className="course-atmosphere-grid">
        <div className="course-progress-wrap">
          <div
            aria-label={`Progresso global ${progress}%`}
            className="course-progress-ring"
            role="img"
            style={{
              background: `conic-gradient(var(--primary) ${progress}%, rgba(0, 210, 106, 0.15) 0)`
            }}
          >
            <div className="course-progress-ring-inner">
              <p className="course-progress-value">{progress.toFixed(1)}%</p>
              <p className="course-progress-label">do curso</p>
            </div>
          </div>
        </div>

        <div className="course-atmosphere-metrics">
          <article className="course-atmosphere-item">
            <p className="course-atmosphere-label">Streak de estudo</p>
            <p className="course-atmosphere-value inline-flex items-center gap-2">
              <Flame className="h-4 w-4 text-[var(--accent)]" />
              {model.streakDays > 0 ? `${model.streakDays} dias` : "Sem dados diários"}
            </p>
          </article>

          <article className="course-atmosphere-item">
            <p className="course-atmosphere-label">Próxima milestone</p>
            <p className="course-atmosphere-value inline-flex items-start gap-2">
              <Target className="mt-0.5 h-4 w-4 text-[var(--primary)]" />
              <span>{model.nextMilestone}</span>
            </p>
          </article>

          <article className="course-atmosphere-item">
            <p className="course-atmosphere-label">Faltante oficial</p>
            <p className="course-atmosphere-value">
              {model.missingCht} CHT ({model.missingChs} CHS)
            </p>
          </article>
        </div>
      </div>
    </motion.section>
  );
}
