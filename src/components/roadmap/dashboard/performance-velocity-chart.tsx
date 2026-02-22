"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";

import type { DashboardVisualModel } from "@/types/dashboard";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface PerformanceVelocityChartProps {
  model: DashboardVisualModel;
}

const options: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        color: "#E8F5E9"
      }
    }
  },
  scales: {
    x: {
      ticks: { color: "#7A8B82" },
      grid: { color: "rgba(31, 42, 34, 0.8)" }
    },
    y: {
      min: 0,
      max: 10,
      ticks: { color: "#7A8B82" },
      grid: { color: "rgba(31, 42, 34, 0.8)" }
    }
  }
};

export function PerformanceVelocityChart({ model }: PerformanceVelocityChartProps) {
  const chartData = useMemo<ChartData<"line"> | null>(() => {
    if (model.performanceVelocity.length === 0) {
      return null;
    }

    const labels = [...model.performanceVelocity.map((point) => point.label), ...model.projectedVelocity.map((point) => point.label)];

    const historical = [...model.performanceVelocity.map((point) => point.value), ...model.projectedVelocity.map(() => null)];
    const projected = [
      ...model.performanceVelocity.map(() => null),
      ...(model.performanceVelocity.length > 0 ? [model.performanceVelocity.at(-1)?.value ?? null] : []),
      ...model.projectedVelocity.map((point) => point.value)
    ];

    const projectedLabels = labels;
    if (projected.length > projectedLabels.length) {
      labels.unshift(model.performanceVelocity.at(-1)?.label ?? "Atual");
      historical.unshift(null);
    }

    return {
      labels,
      datasets: [
        {
          label: "Média histórica",
          data: historical,
          borderColor: "#00D26A",
          backgroundColor: "rgba(0, 210, 106, 0.18)",
          fill: true,
          tension: 0.32,
          pointRadius: 3,
          pointHoverRadius: 5
        },
        {
          label: "Projeção de ritmo",
          data: projected,
          borderColor: "#39FF14",
          borderDash: [8, 6],
          tension: 0.28,
          pointRadius: 2
        }
      ]
    };
  }, [model.performanceVelocity, model.projectedVelocity]);

  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Performance Velocity</h3>
      </header>

      <div className="chart-surface">
        {chartData ? <Line aria-label="Evolução de desempenho" data={chartData} options={options} /> : <p className="empty-copy">Sem histórico suficiente para curva de desempenho.</p>}
      </div>
    </section>
  );
}
