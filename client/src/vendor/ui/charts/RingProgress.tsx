/* RingProgress — small inline-SVG progress ring with a centered value (e.g. a
   percentage badge next to a KPI tile's label). Lightweight custom SVG, not
   Recharts, mirroring Sparkline's precedent — this is a compact badge, not a
   full chart, so pulling in a PieChart for it would be overkill. */
import React from "react";

export function RingProgress({
  value,
  max = 100,
  size = 40,
  stroke = 4,
  color = "var(--accent)",
  trackColor = "var(--border)",
}: {
  /** Current value, 0..max. */
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
}) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const dash = circumference * pct;
  return (
    <svg width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="tnum"
        style={{ fontSize: size * 0.32, fontWeight: 700, fill: "var(--text-primary)" }}
      >
        {Math.round(value)}
      </text>
    </svg>
  );
}
