import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Small, dependency-free charts for the console dashboard, following the
 * dataviz method: one series in the brand blue (validated against the dark
 * surface), thin bars with 4px rounded data-ends anchored to the baseline, a
 * 2px gap between bars, a recessive grid, a hover tooltip per bar, and a table
 * view so no figure lives only in a picture. Text always wears text tokens.
 */

const SERIES = "var(--color-somnus-primary)";

export type Datum = { label: string; value: number; detail?: string };

function niceMax(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 4 >= max) ?? max;
  return step * 4;
}

function TableToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      className="text-xs font-medium text-somnus-subtle underline-offset-2 hover:text-somnus-text hover:underline"
    >
      {shown ? t("charts.showChart") : t("charts.showTable")}
    </button>
  );
}

function DataTable({ data, valueLabel }: { data: Datum[]; valueLabel: string }) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-somnus-subtle">
          <th className="py-1.5 font-medium">{t("charts.period")}</th>
          <th className="py-1.5 text-right font-medium">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label} className="border-t border-white/[0.06]">
            <td className="py-1.5 text-somnus-text">{d.detail ?? d.label}</td>
            <td className="py-1.5 text-right tabular-nums text-somnus-text">{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Vertical bars over time (a single series). */
export function BarChart({
  data,
  valueLabel,
  height = 180,
}: {
  data: Datum[];
  valueLabel: string;
  height?: number;
}) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const width = 600;
  const pad = { top: 12, right: 8, bottom: 26, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, slot - 2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const hovered = hover === null ? null : data[hover];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <TableToggle shown={table} onToggle={() => setTable((s) => !s)} />
      </div>
      {table ? (
        <DataTable data={data} valueLabel={valueLabel} />
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
            role="img"
            aria-labelledby={titleId}
            onMouseLeave={() => setHover(null)}
          >
            <title id={titleId}>{valueLabel}</title>
            {ticks.map((tick) => {
              const y = pad.top + plotH - (tick / max) * plotH;
              return (
                <g key={tick}>
                  <line
                    x1={pad.left}
                    x2={width - pad.right}
                    y1={y}
                    y2={y}
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-somnus-subtle text-[11px]"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = (d.value / max) * plotH;
              const x = pad.left + i * slot + (slot - barW) / 2;
              const y = pad.top + plotH - h;
              const r = Math.min(4, h / 2, barW / 2);
              const showLabel = i === 0 || i === data.length - 1 || i % 3 === 0;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals the tooltip; the table view carries the same data
                <g key={d.label} onMouseEnter={() => setHover(i)}>
                  <rect
                    x={pad.left + i * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                  />
                  {h > 0 ? (
                    <path
                      d={`M${x},${pad.top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${pad.top + plotH} Z`}
                      fill={SERIES}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  ) : null}
                  {i === peak && d.value > 0 ? (
                    <text
                      x={x + barW / 2}
                      y={y - 4}
                      textAnchor="middle"
                      className="fill-somnus-text text-[11px] font-medium"
                    >
                      {d.value}
                    </text>
                  ) : null}
                  {showLabel ? (
                    <text
                      x={x + barW / 2}
                      y={height - 8}
                      textAnchor="middle"
                      className="fill-somnus-subtle text-[11px]"
                    >
                      {d.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotH}
              y2={pad.top + plotH}
              stroke="rgba(255,255,255,0.18)"
            />
          </svg>
          {hovered ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-lg border border-white/10 bg-[#0f1528] px-3 py-2 text-xs shadow-xl"
              style={{
                left: `${(((hover ?? 0) + 0.5) / data.length) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="text-somnus-subtle">{hovered.detail ?? hovered.label}</div>
              <div className="font-semibold tabular-nums text-somnus-text">
                {hovered.value} {valueLabel.toLowerCase()}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a few categories, each labelled directly with its value. */
export function HBarChart({ data, valueLabel }: { data: Datum[]; valueLabel: string }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <TableToggle shown={table} onToggle={() => setTable((s) => !s)} />
      </div>
      {table ? (
        <DataTable data={data} valueLabel={valueLabel} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((d) => (
            <li key={d.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-somnus-text">{d.label}</span>
                <span className="tabular-nums text-somnus-subtle">
                  {d.value}
                  {total > 0 ? ` · ${Math.round((d.value / total) * 100)}%` : ""}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.05]">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${(d.value / max) * 100}%`, background: SERIES }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
