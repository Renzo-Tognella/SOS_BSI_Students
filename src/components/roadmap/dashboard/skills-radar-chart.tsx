"use client";

import { useMemo } from "react";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";

import type { DashboardVisualModel } from "@/types/dashboard";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface SkillsRadarChartProps {
  model: DashboardVisualModel;
}

const options: ChartOptions<"radar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    r: {
      min: 0,
      max: 100,
      grid: { color: "rgba(31, 42, 34, 0.85)" },
      angleLines: { color: "rgba(31, 42, 34, 0.85)" },
      pointLabels: {
        color: "#E8F5E9",
        font: {
          size: 11,
          weight: 600
        }
      },
      ticks: {
        backdropColor: "transparent",
        color: "#7A8B82"
      }
    }
  },
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        color: "#E8F5E9"
      }
    }
  }
};

export function SkillsRadarChart({ model }: SkillsRadarChartProps) {
  const data = useMemo<ChartData<"radar">>(() => {
    return {
      labels: model.skillsRadar.labels,
      datasets: [
        {
          label: "Você",
          data: model.skillsRadar.student,
          borderColor: "#00D26A",
          backgroundColor: "rgba(0, 210, 106, 0.2)",
          borderWidth: 2
        },
        {
          label: "Referência interna",
          data: model.skillsRadar.cohortReference,
          borderColor: "#7A8B82",
          borderDash: [6, 4],
          backgroundColor: "rgba(122, 139, 130, 0.08)",
          borderWidth: 1.5
        }
      ]
    };
  }, [model.skillsRadar]);

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Skills Radar</h3>
      </header>

      <div className="chart-surface h-[320px]">
        <Radar aria-label="Radar de competências" data={data} options={options} />
      </div>
    </section>
  );
}
