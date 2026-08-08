import { GABA_ATOMS, GABA_BONDS, GABA_FORMULA_LABEL } from "./gaba.constants";
import type { GabaBackgroundCopy } from "./gaba.types";

type GabaMoleculeProps = Pick<
  GabaBackgroundCopy,
  "moleculeDescription" | "moleculeTitle" | "signalLabels"
>;

const SIGNALS = [
  { x: 74, y: 88, anchor: "start" },
  { x: 220, y: 54, anchor: "middle" },
  { x: 390, y: 60, anchor: "middle" },
  { x: 550, y: 82, anchor: "middle" },
  { x: 632, y: 132, anchor: "end" },
] as const;

export function GabaMolecule({
  moleculeDescription,
  moleculeTitle,
  signalLabels,
}: GabaMoleculeProps) {
  return (
    <svg
      aria-hidden="true"
      className="gaba-molecule"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 680 440"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id="gaba-molecule-title">{moleculeTitle}</title>
      <desc id="gaba-molecule-description">{moleculeDescription}</desc>

      <defs>
        <radialGradient id="gaba-nitrogen-fill" cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#a9c8ff" />
          <stop offset="0.45" stopColor="#4f88ef" />
          <stop offset="1" stopColor="#173d83" />
        </radialGradient>
        <radialGradient id="gaba-carbon-fill" cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#c9d5eb" />
          <stop offset="0.48" stopColor="#64728d" />
          <stop offset="1" stopColor="#252e42" />
        </radialGradient>
        <radialGradient id="gaba-oxygen-fill" cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#d7ddff" />
          <stop offset="0.45" stopColor="#738cf2" />
          <stop offset="1" stopColor="#304a9c" />
        </radialGradient>
        <linearGradient id="gaba-bond-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8293b2" />
          <stop offset="0.5" stopColor="#d2ddf1" />
          <stop offset="1" stopColor="#53617d" />
        </linearGradient>
        <filter id="gaba-atom-shadow" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="10" floodColor="#010717" floodOpacity="0.65" stdDeviation="9" />
        </filter>
        <filter id="gaba-soft-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id="gaba-bond-glow" x="-80%" y="-160%" width="260%" height="420%">
          <feGaussianBlur result="blur" stdDeviation="3" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g id="ambient-glows">
        <circle
          className="gaba-molecule__ambient gaba-molecule__ambient--one"
          cx="192"
          cy="210"
          r="142"
        />
        <circle
          className="gaba-molecule__ambient gaba-molecule__ambient--two"
          cx="510"
          cy="232"
          r="158"
        />
      </g>

      <g id="sleep-signals">
        {SIGNALS.map((signal, index) => (
          <g
            className="gaba-molecule__signal"
            data-story-node={`signal-${index + 1}`}
            key={signalLabels[index]}
            transform={`translate(${signal.x} ${signal.y})`}
          >
            <circle className="signal-node" r="5" />
            <circle className="signal-node__ring" r="12" />
            <text
              className="signal-label"
              dominantBaseline="middle"
              textAnchor={signal.anchor}
              x={signal.anchor === "start" ? 16 : signal.anchor === "end" ? -16 : 0}
              y={signal.anchor === "middle" ? -20 : 0}
            >
              {signalLabels[index]}
            </text>
          </g>
        ))}
      </g>

      <text className="gaba-molecule__formula" x="340" y="128">
        {GABA_FORMULA_LABEL}
      </text>

      <g id="molecule-shadow">
        <ellipse className="gaba-molecule__ground-shadow" cx="343" cy="326" rx="274" ry="25" />
      </g>

      <g className="gaba-molecule__bonds">
        {GABA_BONDS.map((bond) => (
          <g
            className="bond bond--active"
            data-bond={bond.id}
            data-connects={bond.connects.join(" ")}
            id={bond.id}
            key={bond.id}
          >
            <path className="bond__base" d={bond.path} pathLength="1" />
            <path className="bond__core" d={bond.path} pathLength="1" />
            <path className="bond__highlight" d={bond.path} pathLength="1" />
          </g>
        ))}
      </g>

      <g className="gaba-molecule__atoms">
        {GABA_ATOMS.map((atom) => (
          <g
            className={`atom atom--${atom.element.toLowerCase()}`}
            data-atom={atom.id}
            data-depth={atom.depth}
            data-element={atom.element}
            id={`atom-${atom.id}`}
            key={atom.id}
            transform={`translate(${atom.x} ${atom.y})`}
          >
            <g className="atom__assembly">
              <g className="atom__depth" filter="url(#gaba-atom-shadow)">
                <circle className="atom__glow" r={atom.radius + 16} />
                <circle className="atom__sphere" r={atom.radius} />
                <ellipse
                  className="atom__shade"
                  cx={atom.radius * 0.18}
                  cy={atom.radius * 0.34}
                  rx={atom.radius * 0.7}
                  ry={atom.radius * 0.42}
                />
                <circle className="atom__rim" r={atom.radius - 1.5} />
                <text
                  className={`atom__symbol ${atom.label === atom.element ? "atom__symbol--element" : "atom__symbol--group"}`}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  y="1"
                >
                  {atom.label}
                </text>
              </g>
            </g>
          </g>
        ))}
      </g>

      <g id="specular-highlights">
        {GABA_ATOMS.map((atom) => (
          <ellipse
            className={`atom__specular atom__specular--${atom.element.toLowerCase()}`}
            cx={atom.x - atom.radius * 0.27}
            cy={atom.y - atom.radius * 0.32}
            data-specular={atom.id}
            key={atom.id}
            rx={atom.radius * 0.19}
            ry={atom.radius * 0.12}
            transform={`rotate(-28 ${atom.x} ${atom.y})`}
          />
        ))}
      </g>


    </svg>
  );
}
