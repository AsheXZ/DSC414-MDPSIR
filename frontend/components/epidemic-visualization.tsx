"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  cost: number;
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

type VisualizationMode = "simulation" | "artifact" | "qtable";

type QTablePayload = {
  values: unknown;
  state_bins?: {
    s_bins?: number;
    i_bins?: number;
    r_bins?: number;
    d_bins?: number;
    budget_bins?: number;
  };
};

const GRID_COLS = 20;
const GRID_ROWS = 12;
const GRID_SIZE = GRID_COLS * GRID_ROWS;
const HORIZON = 120;

const ACTION_LABEL: Record<number, string> = {
  0: "No intervention",
  1: "Social distancing",
  2: "Lockdown",
  3: "Vaccination campaign",
};

const ACTION_COLOR: Record<number, string> = {
  0: "#64748b",
  1: "#f59e0b",
  2: "#ef4444",
  3: "#22c55e",
};

const STATE_COLOR: Record<"S" | "I" | "R" | "D", string> = {
  S: "#22c55e",
  I: "#ef4444",
  R: "#38bdf8",
  D: "#64748b",
};

function actionBetaMultiplier(action: number) {
  if (action === 1) return 0.75;
  if (action === 2) return 0.45;
  if (action === 3) return 0.85;
  return 1;
}

function actionVaccinationRate(action: number) {
  return action === 3 ? 0.02 : 0;
}

function actionCost(action: number, params: MDPParameters): number {
  if (action === 1) return params.costs.socialDistancing;
  if (action === 2) return params.costs.lockdown;
  if (action === 3) return params.costs.vaccinationCampaign;
  return params.costs.noIntervention;
}

function mortalityRate(params: MDPParameters): number {
  return Math.max(0, params.mu);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function discretize(
  S: number,
  I: number,
  R: number,
  D: number,
  budget: number,
  N: number,
  budgetCap: number,
  bins: { s: number; i: number; r: number; d?: number; b: number },
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
  };
}

function safeQValues(qValues: unknown): number[] {
  if (!Array.isArray(qValues)) return [0, 0, 0, 0];
  return qValues.map((value) => (typeof value === "number" ? value : 0));
}

function greedyActionFromQ(
  qTableValues: unknown,
  idx: { s: number; i: number; r: number; d?: number; b: number },
): number {
  const table = qTableValues as unknown[];
  const sSlice = (table?.[idx.s] as unknown[] | undefined) ?? [];
  const iSlice = (sSlice[idx.i] as unknown[] | undefined) ?? [];
  const rSlice = (iSlice[idx.r] as unknown[] | undefined) ?? [];

  const leaf =
    typeof idx.d === "number"
      ? (((rSlice[idx.d] as unknown[] | undefined) ?? [])[idx.b] as unknown)
      : (rSlice[idx.b] as unknown);

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
  if (iRatio > 0.22 && budgetLeft >= params.costs.lockdown) return 2;
  if (iRatio > 0.1 && budgetLeft >= params.costs.socialDistancing) return 1;
  if (iRatio > 0.04 && budgetLeft >= params.costs.vaccinationCampaign) return 3;
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
  horizon = HORIZON,
): TimelinePoint[] {
  const N = Math.max(1, params.population);
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
    const intendedCost = actionCost(action, params);
    if (intendedCost > budget) action = 0;

    const spent = actionCost(action, params);
    const betaEff = params.beta * actionBetaMultiplier(action);
    const vaccRate = actionVaccinationRate(action);
    const mu = mortalityRate(params);

    const vaccinated = Math.min(S, vaccRate * S);
    const SAfterVax = S - vaccinated;
    const RAfterVax = R + vaccinated;

    const newInfections = Math.min(SAfterVax, betaEff * (SAfterVax * I / N));
    const totalOutRate = Math.max(0, params.gamma + mu);
    const totalOut = Math.min(I, totalOutRate * I);
    const newRecoveries = totalOutRate > 0 ? totalOut * (params.gamma / totalOutRate) : 0;
    const newDeaths = totalOutRate > 0 ? totalOut * (mu / totalOutRate) : 0;

    S = Math.max(0, SAfterVax - newInfections);
    I = Math.max(0, I + newInfections - newRecoveries - newDeaths);
    R = Math.max(0, RAfterVax + newRecoveries);
    D = Math.max(0, D + newDeaths);

    const total = S + I + R + D;
    if (total > 0) {
      const scale = N / total;
      S *= scale;
      I *= scale;
      R *= scale;
      D *= scale;
    }

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

function cellClass(state: "S" | "I" | "R" | "D") {
  if (state === "I") return "bg-rose-500";
  if (state === "D") return "bg-slate-500";
  if (state === "R") return "bg-sky-400";
  return "bg-emerald-500";
}

export function EpidemicVisualization({
  params,
}: {
  params: MDPParameters;
}) {
  const [artifactTimeline, setArtifactTimeline] = useState<TimelinePoint[]>([]);
  const [qTablePayload, setQTablePayload] = useState<QTablePayload | null>(null);
  const [mode, setMode] = useState<VisualizationMode>("simulation");
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState(250);

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

        if (!cancelled) {
          setArtifactTimeline(timeline);
          if (timeline.length > 0) setMode("artifact");
        }
      } catch {
        if (!cancelled) {
          setArtifactTimeline([]);
        }
      }
    };

    const loadQTable = async () => {
      try {
        const response = await fetch("/api/q-table", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && payload?.values) {
          setQTablePayload({
            values: payload.values,
            state_bins: payload.state_bins,
          });
        }
      } catch {
        if (!cancelled) setQTablePayload(null);
      }
    };

    loadTrainingHistory();
    loadQTable();

    return () => {
      cancelled = true;
    };
  }, [params.budget]);

  const simulatedTimeline = useMemo(() => {
    return buildTimeline(params, ({ I, N, budget }) => heuristicAction(I / N, budget, params));
  }, [params]);

  const qTableTimeline = useMemo(() => {
    if (!qTablePayload?.values) return [];

    const bins = {
      s: qTablePayload.state_bins?.s_bins ?? 20,
      i: qTablePayload.state_bins?.i_bins ?? 20,
      r: qTablePayload.state_bins?.r_bins ?? 20,
      d: qTablePayload.state_bins?.d_bins,
      b: qTablePayload.state_bins?.budget_bins ?? 10,
    };

    return buildTimeline(params, ({ S, I, R, D, budget, N }) => {
      const idx = discretize(S, I, R, D, budget, N, params.budget, bins);
      return greedyActionFromQ(qTablePayload.values, idx);
    });
  }, [params, qTablePayload]);

  const availableModes = useMemo(() => {
    const modes: VisualizationMode[] = ["simulation"];
    if (artifactTimeline.length > 0) modes.push("artifact");
    if (qTableTimeline.length > 0) modes.push("qtable");
    return modes;
  }, [artifactTimeline.length, qTableTimeline.length]);

  const activeMode = availableModes.includes(mode) ? mode : availableModes[0];

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

  const current = timeline[Math.min(stepIndex, Math.max(0, timeline.length - 1))] ?? {
    t: 0,
    S: params.population,
    I: 0,
    R: 0,
    D: 0,
    budgetRemaining: params.budget,
    budgetSpent: 0,
    deathsThisStep: 0,
    action: 0,
  };

  const population = Math.max(1, current.S + current.I + current.R + current.D);
  const sCells = Math.round((current.S / population) * GRID_SIZE);
  const iCells = Math.round((current.I / population) * GRID_SIZE);
  const dCells = Math.round((current.D / population) * GRID_SIZE);

  const cells = Array.from({ length: GRID_SIZE }, (_, index) => {
    const noise = ((Math.sin((index + 1) * 17 + current.t * 0.75) + 1) * 0.5 - 0.5) * 0.08;
    const sCut = sCells + Math.round(noise * GRID_SIZE * 0.4);
    const iCut = sCells + iCells + Math.round(noise * GRID_SIZE * 0.25);
    const dCut = sCells + iCells + dCells + Math.round(noise * GRID_SIZE * 0.15);

    let state: "S" | "I" | "R" | "D" = "R";
    if (index < sCut) state = "S";
    else if (index < iCut) state = "I";
    else if (index < dCut) state = "D";

    return { id: index, state };
  });

  const chartData = timeline.slice(0, stepIndex + 1).map((row) => ({
    t: row.t,
    infected: Number(row.I.toFixed(2)),
    deceased: Number(row.D.toFixed(2)),
    budgetSpent: Number(row.budgetSpent.toFixed(2)),
    action: row.action,
  }));

  const spreadNetwork = useMemo(() => {
    const totalNodes = 120;
    const sCount = Math.round((current.S / population) * totalNodes);
    const iCount = Math.round((current.I / population) * totalNodes);
    const dCount = Math.round((current.D / population) * totalNodes);
    const rCount = Math.max(0, totalNodes - sCount - iCount - dCount);

    const nodes: Array<{ id: number; x: number; y: number; state: "S" | "I" | "R" | "D" }> = [];
    for (let index = 0; index < totalNodes; index += 1) {
      const angle = index * 0.47 + current.t * 0.09;
      const radius = 10 + ((index % 17) / 16) * 34;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;

      let state: "S" | "I" | "R" | "D" = "R";
      if (index < sCount) state = "S";
      else if (index < sCount + iCount) state = "I";
      else if (index < sCount + iCount + dCount) state = "D";
      else if (index < sCount + iCount + rCount) state = "R";

      nodes.push({ id: index, x, y, state });
    }

    const infected = nodes.filter((node) => node.state === "I");
    const susceptible = nodes.filter((node) => node.state === "S");
    const links: Array<{ source: number; target: number }> = [];
    if (infected.length > 0 && susceptible.length > 0) {
      const maxLinks = Math.min(90, Math.round((current.I / population) * 260));
      for (let i = 0; i < maxLinks; i += 1) {
        const source = infected[(i * 7 + current.t) % infected.length];
        const target = susceptible[(i * 11 + current.t * 3) % susceptible.length];
        links.push({ source: source.id, target: target.id });
      }
    }

    return { nodes, links };
  }, [current.D, current.I, current.S, current.t, population]);

  return (
    <section className="grid gap-6">
      <article className="rounded-3xl border border-app-panel-border bg-app-panel p-6 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Spatial Spread Grid</h2>
            <p className="text-sm text-app-muted">
              Source mode: {activeMode === "artifact" ? "Trained episode replay" : activeMode === "qtable" ? "Q-table greedy policy" : "Browser simulation"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeMode}
              onChange={(event) => setMode(event.target.value as VisualizationMode)}
              className="rounded-full border border-app-panel-border bg-app px-3 py-2 text-xs"
            >
              <option value="simulation">Simulation</option>
              <option value="artifact" disabled={!availableModes.includes("artifact")}>
                Artifact Replay
              </option>
              <option value="qtable" disabled={!availableModes.includes("qtable")}>
                Q-table Greedy
              </option>
            </select>
            <button
              type="button"
              onClick={() => setIsPlaying((value) => !value)}
              className="rounded-full border border-app-panel-border bg-app px-4 py-2 text-xs font-semibold tracking-[0.12em] uppercase"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStepIndex(0);
                setIsPlaying(true);
              }}
              className="rounded-full border border-app-panel-border bg-app px-4 py-2 text-xs font-semibold tracking-[0.12em] uppercase"
            >
              Reset
            </button>
            <select
              value={speedMs}
              onChange={(event) => setSpeedMs(Number(event.target.value))}
              className="rounded-full border border-app-panel-border bg-app px-3 py-2 text-xs"
            >
              <option value={120}>Fast</option>
              <option value={250}>Normal</option>
              <option value={500}>Slow</option>
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
            <p className="text-xs uppercase tracking-[0.1em] text-app-muted">Time Step</p>
            <p className="text-base font-semibold">{current.t}</p>
          </div>
          <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
            <p className="text-xs uppercase tracking-[0.1em] text-app-muted">Infected</p>
            <p className="text-base font-semibold">{current.I.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
            <p className="text-xs uppercase tracking-[0.1em] text-app-muted">Deceased</p>
            <p className="text-base font-semibold">{current.D.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
            <p className="text-xs uppercase tracking-[0.1em] text-app-muted">Budget Left</p>
            <p className="text-base font-semibold">{current.budgetRemaining.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2 sm:col-span-2">
            <p className="text-xs uppercase tracking-[0.1em] text-app-muted">Action</p>
            <p className="text-base font-semibold" style={{ color: ACTION_COLOR[current.action] ?? "currentColor" }}>
              {ACTION_LABEL[current.action] ?? "Unknown"}
            </p>
          </div>
        </div>

        <div
          className="mt-5 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
        >
          {cells.map((cell) => (
            <div
              key={cell.id}
              className={`aspect-square rounded-[3px] ${cellClass(cell.state)}`}
              title={cell.state}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-4 text-xs text-app-muted">
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Susceptible</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Infected</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-slate-500" /> Deceased</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Recovered</span>
        </div>
      </article>

      <article className="rounded-3xl border border-app-panel-border bg-app-panel p-6 backdrop-blur-md">
        <h2 className="text-lg font-semibold">Spread Network View</h2>
        <p className="text-sm text-app-muted">
          Graph-style contact map approximation of infection pressure across connected groups.
        </p>

        <div className="mt-4 rounded-2xl border border-app-panel-border bg-app p-3">
          <svg viewBox="0 0 100 100" className="h-[320px] w-full">
            {spreadNetwork.links.map((link, index) => {
              const source = spreadNetwork.nodes[link.source];
              const target = spreadNetwork.nodes[link.target];
              return (
                <line
                  key={`${link.source}-${link.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="rgba(239,68,68,0.24)"
                  strokeWidth={0.45}
                />
              );
            })}
            {spreadNetwork.nodes.map((node) => (
              <circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                r={node.state === "I" ? 1.5 : 1.2}
                fill={STATE_COLOR[node.state]}
                opacity={node.state === "I" ? 1 : 0.9}
              />
            ))}
          </svg>
        </div>
      </article>

      <article className="rounded-3xl border border-app-panel-border bg-app-panel p-6 backdrop-blur-md">
        <h2 className="text-lg font-semibold">Time-Series Trends</h2>
        <p className="text-sm text-app-muted">Tracking total infections and budget depletion over time.</p>

        <div className="mt-5 h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,120,110,0.28)" />
              <XAxis dataKey="t" tick={{ fill: "currentColor", fontSize: 12 }} />
              <YAxis tick={{ fill: "currentColor", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: "rgba(7, 18, 16, 0.92)",
                  border: "1px solid rgba(214,236,228,0.24)",
                  borderRadius: "12px",
                  color: "#d6ece4",
                }}
              />
              <Line
                type="monotone"
                dataKey="infected"
                name="Infected"
                stroke="#f43f5e"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="deceased"
                name="Deceased"
                stroke="#64748b"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="budgetSpent"
                name="Budget Spent"
                stroke="#06b6d4"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-3xl border border-app-panel-border bg-app-panel p-6 backdrop-blur-md">
        <h2 className="text-lg font-semibold">Action Trace</h2>
        <p className="text-sm text-app-muted">Intervention index selected at each time step.</p>

        <div className="mt-5 h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,120,110,0.28)" />
              <XAxis dataKey="t" tick={{ fill: "currentColor", fontSize: 12 }} />
              <YAxis domain={[0, 3]} tickCount={4} tick={{ fill: "currentColor", fontSize: 12 }} />
              <Tooltip
                formatter={(value: unknown) => {
                  const action = typeof value === "number" ? value : Number(value ?? 0);
                  return ACTION_LABEL[action] ?? String(action);
                }}
                contentStyle={{
                  background: "rgba(7, 18, 16, 0.92)",
                  border: "1px solid rgba(214,236,228,0.24)",
                  borderRadius: "12px",
                  color: "#d6ece4",
                }}
              />
              <Bar dataKey="action" name="Action" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={ACTION_COLOR[entry.action] ?? "#f59e0b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-app-muted sm:grid-cols-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-app-panel-border bg-app px-3 py-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-100" style={{ backgroundColor: ACTION_COLOR[0] }}>0</span>
            <span>No intervention</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-app-panel-border bg-app px-3 py-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-100" style={{ backgroundColor: ACTION_COLOR[1] }}>1</span>
            <span>Social distancing</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-app-panel-border bg-app px-3 py-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-100" style={{ backgroundColor: ACTION_COLOR[2] }}>2</span>
            <span>Lockdown</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-app-panel-border bg-app px-3 py-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-100" style={{ backgroundColor: ACTION_COLOR[3] }}>3</span>
            <span>Vaccination campaign</span>
          </div>
        </div>
      </article>
    </section>
  );
}
