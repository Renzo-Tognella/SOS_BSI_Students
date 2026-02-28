interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  hint?: string;
}

export function MetricCard({ title, value, subtitle, hint }: MetricCardProps) {
  return (
    <article className="metric-card">
      <p className="metric-card-title">{title}</p>
      <p className="metric-card-value">{value}</p>
      {subtitle ? <p className="metric-card-subtitle">{subtitle}</p> : null}
      {hint ? <p className="metric-card-hint">{hint}</p> : null}
    </article>
  );
}

