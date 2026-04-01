"use client";

import { useEffect, useMemo, useState } from "react";

import type { MDPParameters } from "@/components/mdp-params";

type EpisodeHistoryRecord = {
  t: number;
  state: {
    S: number;
    I: number;
    R: number;
    D?: number;
    budget_remaining: number;
  };
  action_effective: number;
};

type TimelinePoint = {
  t: number;
  S: number;
  I: number;
  R: number;
  D: number;
  budgetRemaining: number;
  budgetSpent: number;
  deathsThisStep: number;
  action: number;
};

export type VisualizationMode = "simulation" | "artifact" | "qtable";

type QTablePayload = {
  values: unknown;
  state_bins?: {
    s_bins?: number;
    i_bins?: number;
    r_bins?: number;
    d_bins?: number;
    budget_bins?: number;
    beta_bins?: number;
    gamma_bins?: number;
  };
};

const ACTION_LABEL: Record<number, string> = {
  0: "No intervention",
  1: "Social distancing",
  2: "Lockdown",
  3: "Vaccination",
};

const ACTION_COLOR: Record<number, string> = {
  0: "#888888",
  1: "#d5a063",
  2: "#df7272",
  3: "#6dc79d",
};

const SERIES = [
  { key: "S", label: "Susceptible", color: "#6bbf9a" },
  { key: "I", label: "Infected", color: "#ef6a6a" },
  { key: "R", label: "Recovered", color: "#6aa7df" },
  { key: "D", label: "Deceased", color: "#8a8a8a" },
] as const;

const HORIZON_FALLBACK = 180;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function actionBetaMultiplier(action: number): number {
  if (action === 1) return 0.75;
  if (action === 2) return 0.45;
  if (action === 3) return 0.85;
  return 1;
}

function actionVaccinationRate(action: number): number {
  return action === 3 ? 0.02 : 0;
}

function actionCost(action: number, params: MDPParameters): number {
  if (action === 1) return params.costs.socialDistancing;
  if (action === 2) return params.costs.lockdown;
  if (action === 3) return params.costs.vaccinationCampaign;
  return params.costs.noIntervention;
}

function safeQValues(qValues: unknown): number[] {
  if (!Array.isArray(qValues)) return [0, 0, 0, 0];
  return qValues.map((value) => (typeof value === "number" ? value : 0));
}

function greedyActionFromQ(
  qTableValues: unknown,
  idx: { s: number; i: number; r: number; d?: number; b: number; beta?: number; gamma?: number },
): number {
  const table = qTableValues as unknown[];
  const sSlice = (table?.[idx.s] as unknown[] | undefined) ?? [];
  const iSlice = (sSlice[idx.i] as unknown[] | undefined) ?? [];
  const rSlice = (iSlice[idx.r] as unknown[] | undefined) ?? [];

  const afterD = typeof idx.d === "number" ? ((rSlice[idx.d] as unknown[] | undefined) ?? []) : rSlice;
  const afterBudget = ((afterD as unknown[] | undefined) ?? [])[idx.b] as unknown;
  const afterBeta =
    typeof idx.beta === "number"
      ? (((afterBudget as unknown[] | undefined) ?? [])[idx.beta] as unknown)
      : afterBudget;
  const leaf =
    typeof idx.gamma === "number"
      ? (((afterBeta as unknown[] | undefined) ?? [])[idx.gamma] as unknown)
      : afterBeta;

  const qValues = safeQValues(leaf);
  let bestAction = 0;
  let bestValue = qValues[0] ?? 0;
  for (let action = 1; action < qValues.length; action += 1) {
    if ((qValues[action] ?? -Infinity) > bestValue) {
      bestValue = qValues[action] ?? bestValue;
      bestAction = action;
    }
  }
  return bestAction;
}

function discretize(
  S: number,
  I: number,
  R: number,
  D: number,
  budget: number,
  beta: number,
  gamma: number,
  N: number,
  budgetCap: number,
  bins: {
    s: number;
    i: number;
    r: number;
    d?: number;
    b: number;
    beta?: number;
    gamma?: number;
  },
) {
  const sRatio = S / Math.max(1, N);
  const iRatio = I / Math.max(1, N);
  const rRatio = R / Math.max(1, N);
  const dRatio = D / Math.max(1, N);
  const bRatio = budget / Math.max(1e-9, budgetCap);

  return {
    s: clamp(Math.floor(sRatio * bins.s), 0, bins.s - 1),
    i: clamp(Math.floor(iRatio * bins.i), 0, bins.i - 1),
    r: clamp(Math.floor(rRatio * bins.r), 0, bins.r - 1),
    d: bins.d ? clamp(Math.floor(dRatio * bins.d), 0, bins.d - 1) : undefined,
    b: clamp(Math.floor(bRatio * bins.b), 0, bins.b - 1),
    beta:
      typeof bins.beta === "number"
        ? clamp(Math.floor(clamp(beta, 0, 1) * bins.beta), 0, bins.beta - 1)
        : undefined,
    gamma:
      typeof bins.gamma === "number"
        ? clamp(Math.floor(clamp(gamma, 0, 1) * bins.gamma), 0, bins.gamma - 1)
        : undefined,
  };
}

function heuristicAction(iRatio: number, budgetLeft: number, params: MDPParameters): number {
  if (
    budgetLeft <
    Math.min(
      params.costs.socialDistancing,
      params.costs.lockdown,
      params.costs.vaccinationCampaign,
    )
  ) {
    return 0;
  }
  if (iRatio > 0.2 && budgetLeft >= params.costs.lockdown) return 2;
  if (iRatio > 0.1 && budgetLeft >= params.costs.socialDistancing) return 1;
  if (iRatio > 0.045 && budgetLeft >= params.costs.vaccinationCampaign) return 3;
  return 0;
}

function buildTimeline(
  params: MDPParameters,
  policy: (ctx: {
    S: number;
    I: number;
    R: number;
    D: number;
    budget: number;
    N: number;
    t: number;
  }) => number,
): TimelinePoint[] {
  const N = Math.max(1, params.population);
  const horizon = Math.max(10, params.horizon ?? HORIZON_FALLBACK);

  let S = Math.max(
    0,
    params.population -
      params.initialInfected -
      params.initialRecovered -
      params.initialDeceased,
  );
  let I = Math.max(0, params.initialInfected);
  let R = Math.max(0, params.initialRecovered);
  let D = Math.max(0, params.initialDeceased);
  let budget = Math.max(0, params.budget);

  const timeline: TimelinePoint[] = [
    {
      t: 0,
      S,
      I,
      R,
      D,
      budgetRemaining: budget,
      budgetSpent: params.budget - budget,
      deathsThisStep: 0,
      action: 0,
    },
  ];

  for (let t = 1; t <= horizon; t += 1) {
    let action = policy({ S, I, R, D, budget, N, t });
    if (actionCost(action, params) > budget) action = 0;

    const spent = actionCost(action, params);
    const betaEff = params.beta * actionBetaMultiplier(action);
    const vaccRate = actionVaccinationRate(action);

    const vaccinated = Math.min(S, vaccRate * S);
    const SAfterVax = S - vaccinated;
    const RAfterVax = R + vaccinated;

    const newInfections = Math.min(SAfterVax, betaEff * (SAfterVax * I / N));
    const totalOutRate = Math.max(0, params.gamma + params.mu);
    const totalOut = Math.min(I, totalOutRate * I);
    const newRecoveries = totalOutRate > 0 ? totalOut * (params.gamma / totalOutRate) : 0;
    const newDeaths = totalOutRate > 0 ? totalOut * (params.mu / totalOutRate) : 0;

    let SNext = Math.max(0, SAfterVax - newInfections);
    let INext = Math.max(0, I + newInfections - newRecoveries - newDeaths);
    let RNext = Math.max(0, RAfterVax + newRecoveries);
    const DNext = clamp(D + newDeaths, 0, N);

    const livingTarget = Math.max(0, N - DNext);
    const livingTotal = SNext + INext + RNext;
    if (livingTotal > 0) {
      const scale = livingTarget / livingTotal;
      SNext *= scale;
      INext *= scale;
      RNext *= scale;
    } else {
      SNext = 0;
      INext = 0;
      RNext = 0;
    }

    S = SNext;
    I = INext;
    R = RNext;
    D = DNext;
    budget = Math.max(0, budget - spent);

    timeline.push({
      t,
      S,
      I,
      R,
      D,
      budgetRemaining: budget,
      budgetSpent: Math.max(0, params.budget - budget),
      deathsThisStep: newDeaths,
      action,
    });

    if (I < 1e-3) break;
  }

  return timeline;
}

function buildArtifactTimeline(history: EpisodeHistoryRecord[], budgetCap: number): TimelinePoint[] {
  return history.map((row, index) => {
    const dNow = Number(row.state.D ?? 0);
    const dPrev = index > 0 ? Number(history[index - 1]?.state?.D ?? 0) : 0;
    return {
      t: row.t,
      S: row.state.S,
      I: row.state.I,
      R: row.state.R,
      D: dNow,
      budgetRemaining: row.state.budget_remaining,
      budgetSpent: Math.max(0, budgetCap - row.state.budget_remaining),
      deathsThisStep: Math.max(0, dNow - dPrev),
      action: row.action_effective,
    };
  });
}

function pathFromSeries(
  timeline: TimelinePoint[],
  key: keyof Pick<TimelinePoint, "S" | "I" | "R" | "D">,
  width: number,
  height: number,
  margin: { left: number; right: number; top: number; bottom: number },
  yMax: number,
): string {
  if (timeline.length === 0) return "";
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const tMax = Math.max(1, timeline[timeline.length - 1]?.t ?? 1);

  return timeline
    .map((point, index) => {
      const x = margin.left + (point.t / tMax) * innerW;
      const y = margin.top + (1 - Number(point[key]) / yMax) * innerH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function EpidemicVisualization({
  params,
  onModeChange,
}: {
  params: MDPParameters;
  onModeChange?: (mode: VisualizationMode) => void;
}) {
  const [artifactTimeline, setArtifactTimeline] = useState<TimelinePoint[]>([]);
  const [qTablePayload, setQTablePayload] = useState<QTablePayload | null>(null);
  const [mode, setMode] = useState<VisualizationMode>("simulation");
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState(130);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTrainingHistory = async () => {
      try {
        const response = await fetch("/api/training-data", { cache: "no-store" });
        const payload = await response.json();
        const budgetCap =
          Number(payload?.environment?.budget) > 0
            ? Number(payload.environment.budget)
            : params.budget;
        const timeline = buildArtifactTimeline(payload?.best_episode_history ?? [], budgetCap);
        if (!cancelled) setArtifactTimeline(timeline);
      } catch {
        if (!cancelled) setArtifactTimeline([]);
      }
    };

    const loadQTable = async () => {
      try {
        const response = await fetch("/api/q-table", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && payload?.values) {
          setQTablePayload({ values: payload.values, state_bins: payload.state_bins });
        }
      } catch {
        if (!cancelled) setQTablePayload(null);
      }
    };

    void loadTrainingHistory();
    void loadQTable();

    return () => {
      cancelled = true;
    };
  }, [params.budget]);

  const simulatedTimeline = useMemo(
    () => buildTimeline(params, ({ I, N, budget }) => heuristicAction(I / N, budget, params)),
    [params],
  );

  const qTableTimeline = useMemo(() => {
    if (!qTablePayload?.values) return [];

    const bins = {
      s: qTablePayload.state_bins?.s_bins ?? 6,
      i: qTablePayload.state_bins?.i_bins ?? 6,
      r: qTablePayload.state_bins?.r_bins ?? 6,
      d: qTablePayload.state_bins?.d_bins,
      b: qTablePayload.state_bins?.budget_bins ?? 8,
      beta: qTablePayload.state_bins?.beta_bins,
      gamma: qTablePayload.state_bins?.gamma_bins,
    };

    return buildTimeline(params, ({ S, I, R, D, budget, N }) => {
      const idx = discretize(
        S,
        I,
        R,
        D,
        budget,
        params.beta,
        params.gamma,
        N,
        params.budget,
        bins,
      );
      return greedyActionFromQ(qTablePayload.values, idx);
    });
  }, [params, qTablePayload]);

  const availableModes = useMemo(() => {
    const modes: VisualizationMode[] = ["simulation"];
    if (artifactTimeline.length > 0) modes.push("artifact");
    if (qTableTimeline.length > 0) modes.push("qtable");
    return modes;
  }, [artifactTimeline.length, qTableTimeline.length]);

  const activeMode = availableModes.includes(mode) ? mode : "simulation";

  useEffect(() => {
    onModeChange?.(activeMode);
  }, [activeMode, onModeChange]);

  const timeline =
    activeMode === "artifact"
      ? artifactTimeline
      : activeMode === "qtable"
        ? qTableTimeline
        : simulatedTimeline;

  useEffect(() => {
    if (!isPlaying) return;
    if (timeline.length <= 1) return;
    if (stepIndex >= timeline.length - 1) return;

    const id = window.setTimeout(() => {
      setStepIndex((current) => Math.min(current + 1, timeline.length - 1));
    }, speedMs);

    return () => window.clearTimeout(id);
  }, [isPlaying, speedMs, stepIndex, timeline]);

  const boundedStepIndex = Math.min(stepIndex, Math.max(0, timeline.length - 1));

  const current = useMemo(
    () =>
      timeline[boundedStepIndex] ?? {
        ...EMPTY_TIMELINE_POINT,
        S: params.population,
        budgetRemaining: params.budget,
      },
    [boundedStepIndex, params.budget, params.population, timeline],
  );

  const actionHistory = useMemo(
    () => timeline.slice(Math.max(0, boundedStepIndex - 14), boundedStepIndex + 1).reverse(),
    [boundedStepIndex, timeline],
  );

  const chart = useMemo(() => {
    const width = 920;
    const height = 400;
    const margin = { left: 58, right: 22, top: 20, bottom: 48 };
    const yMax = Math.max(1, params.population);
    const xMax = Math.max(1, timeline[timeline.length - 1]?.t ?? 1);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const yTicks = 5;
    const xTicks = 6;

    const hoverStep =
      hoverX === null
        ? boundedStepIndex
        : clamp(
            Math.round(((hoverX - margin.left) / Math.max(1, innerW)) * xMax),
            0,
            xMax,
          );

    let hoverPoint = timeline[boundedStepIndex] ?? current;
    if (timeline.length > 0) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const point of timeline) {
        const distance = Math.abs(point.t - hoverStep);
        if (distance < minDistance) {
          minDistance = distance;
          hoverPoint = point;
        }
      }
    }

    const hoverXPos = margin.left + (hoverPoint.t / xMax) * innerW;

    return {
      width,
      height,
      margin,
      yMax,
      xMax,
      yTicks,
      xTicks,
      innerH,
      hoverPoint,
      hoverXPos,
      seriesPaths: {
        S: pathFromSeries(timeline, "S", width, height, margin, yMax),
        I: pathFromSeries(timeline, "I", width, height, margin, yMax),
        R: pathFromSeries(timeline, "R", width, height, margin, yMax),
        D: pathFromSeries(timeline, "D", width, height, margin, yMax),
      },
    };
  }, [boundedStepIndex, current, hoverX, params.population, timeline]);

  return (
    <section className="grid gap-3 rounded-2xl border border-app-panel-border bg-app-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-app-muted">Epidemic Trajectory</p>
          <h2 className="text-base font-semibold">Compartment Dynamics</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={activeMode}
            onChange={(event) => {
              setMode(event.target.value as VisualizationMode);
              setStepIndex(0);
              setIsPlaying(true);
            }}
            className="rounded-full border border-app-panel-border bg-app px-3 py-2"
          >
            <option value="simulation">Simulation</option>
            <option value="artifact" disabled={!availableModes.includes("artifact")}>Artifact</option>
            <option value="qtable" disabled={!availableModes.includes("qtable")}>Q-table</option>
          </select>
          <button
            type="button"
            onClick={() => setIsPlaying((value) => !value)}
            className="rounded-full border border-app-panel-border bg-app px-4 py-2"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <select
            value={speedMs}
            onChange={(event) => setSpeedMs(Number(event.target.value))}
            className="rounded-full border border-app-panel-border bg-app px-3 py-2"
          >
            <option value={80}>Fast</option>
            <option value={130}>Normal</option>
            <option value={220}>Slow</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.45fr_0.55fr]">
        <div className="rounded-xl border border-app-panel-border bg-black p-3">
          <div
            className="relative"
            onMouseMove={(event) => {
              const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
              setHoverX(event.clientX - rect.left);
            }}
            onMouseLeave={() => setHoverX(null)}
          >
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-[360px] w-full md:h-[430px]">
              {Array.from({ length: chart.yTicks + 1 }, (_, i) => {
                const y =
                  chart.margin.top +
                  (i / chart.yTicks) * (chart.height - chart.margin.top - chart.margin.bottom);
                const value = ((chart.yTicks - i) / chart.yTicks) * chart.yMax;
                return (
                  <g key={`y-${i}`}>
                    <line
                      x1={chart.margin.left}
                      y1={y}
                      x2={chart.width - chart.margin.right}
                      y2={y}
                      stroke="rgba(255,255,255,0.1)"
                      strokeWidth="1"
                    />
                    <text x={10} y={y + 4} fill="#9a9a9a" fontSize="11">
                      {Math.round(value)}
                    </text>
                  </g>
                );
              })}

              {Array.from({ length: chart.xTicks + 1 }, (_, i) => {
                const x = chart.margin.left + (i / chart.xTicks) * (chart.width - chart.margin.left - chart.margin.right);
                const value = Math.round((i / chart.xTicks) * chart.xMax);
                return (
                  <g key={`x-${i}`}>
                    <line
                      x1={x}
                      y1={chart.margin.top}
                      x2={x}
                      y2={chart.height - chart.margin.bottom}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="1"
                    />
                    <text x={x - 8} y={chart.height - 16} fill="#9a9a9a" fontSize="11">
                      {value}
                    </text>
                  </g>
                );
              })}

              <line
                x1={chart.margin.left}
                y1={chart.height - chart.margin.bottom}
                x2={chart.width - chart.margin.right}
                y2={chart.height - chart.margin.bottom}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1.1"
              />
              <line
                x1={chart.margin.left}
                y1={chart.margin.top}
                x2={chart.margin.left}
                y2={chart.height - chart.margin.bottom}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1.1"
              />

              {(Object.keys(chart.seriesPaths) as Array<keyof typeof chart.seriesPaths>).map((key) => (
                <path
                  key={key}
                  d={chart.seriesPaths[key]}
                  fill="none"
                  stroke={SERIES.find((s) => s.key === key)?.color ?? "#fff"}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}

              <line
                x1={chart.hoverXPos}
                y1={chart.margin.top}
                x2={chart.hoverXPos}
                y2={chart.height - chart.margin.bottom}
                stroke="rgba(255,255,255,0.45)"
                strokeDasharray="4 4"
              />

              <text x={chart.width / 2 - 24} y={chart.height - 4} fill="#9a9a9a" fontSize="12">
                Time step
              </text>
              <text x={8} y={14} fill="#9a9a9a" fontSize="12">
                Population
              </text>
            </svg>

            <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-app-panel-border bg-app px-2 py-1 text-xs">
              <p>t={chart.hoverPoint.t}</p>
              <p style={{ color: SERIES[0].color }}>S={chart.hoverPoint.S.toFixed(1)}</p>
              <p style={{ color: SERIES[1].color }}>I={chart.hoverPoint.I.toFixed(1)}</p>
              <p style={{ color: SERIES[3].color }}>D={chart.hoverPoint.D.toFixed(1)}</p>
              <p style={{ color: ACTION_COLOR[chart.hoverPoint.action] }}>
                {ACTION_LABEL[chart.hoverPoint.action]}
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-xs text-app-muted">
            {SERIES.map((entry) => (
              <span key={entry.key} className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                {entry.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-xl border border-app-panel-border bg-app p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Current</p>
            <p className="mt-1 text-sm">Infected {current.I.toFixed(1)}</p>
            <p className="text-sm">Deceased {current.D.toFixed(1)}</p>
            <p className="text-sm">Budget {current.budgetRemaining.toFixed(1)}</p>
            <p className="text-sm" style={{ color: ACTION_COLOR[current.action] }}>
              {ACTION_LABEL[current.action]}
            </p>
          </div>

          <div className="rounded-xl border border-app-panel-border bg-app p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Action History</p>
            <div className="mt-2 max-h-[255px] space-y-1 overflow-auto text-xs">
              {actionHistory.map((row) => (
                <div key={`${row.t}-${row.action}`} className="flex items-center justify-between rounded-md border border-app-panel-border px-2 py-1">
                  <span className="text-app-muted">t{row.t}</span>
                  <span style={{ color: ACTION_COLOR[row.action] }}>{ACTION_LABEL[row.action]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const EMPTY_TIMELINE_POINT: TimelinePoint = {
  t: 0,
  S: 1,
  I: 0,
  R: 0,
  D: 0,
  budgetRemaining: 0,
  budgetSpent: 0,
  deathsThisStep: 0,
  action: 0,
};
