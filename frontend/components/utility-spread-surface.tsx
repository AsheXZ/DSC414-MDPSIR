"use client";

import { useEffect, useMemo, useState } from "react";

import type { MDPParameters } from "@/components/mdp-params";

type UtilitySpreadSurfaceProps = {
  params: MDPParameters;
  visualizationMode: "simulation" | "artifact" | "qtable";
  onResetSimulation: () => void;
};

type ArtifactHistoryPoint = {
  t: number;
  state?: {
    S?: number;
    I?: number;
    R?: number;
    D?: number;
    budget_remaining?: number;
  };
  action_effective?: number;
};

type LiveState = {
  t: number;
  S: number;
  I: number;
  R: number;
  D: number;
  budget: number;
  action: number;
};

type PolicyState = "no_intervention" | "social_distancing" | "lockdown" | "vaccination";

type GroundStatus = "Controlled" | "Watch" | "Strained" | "Out of Control" | "Failed State";

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

function choosePolicyAction(iRatio: number, budget: number, params: MDPParameters): number {
  if (iRatio > 0.2 && budget >= params.costs.lockdown) return 2;
  if (iRatio > 0.1 && budget >= params.costs.socialDistancing) return 1;
  if (iRatio > 0.045 && budget >= params.costs.vaccinationCampaign) return 3;
  return 0;
}

function buildInitialLiveState(params: MDPParameters): LiveState {
  return {
    t: 0,
    S: Math.max(
      0,
      params.population - params.initialInfected - params.initialRecovered - params.initialDeceased,
    ),
    I: Math.max(0, params.initialInfected),
    R: Math.max(0, params.initialRecovered),
    D: Math.max(0, params.initialDeceased),
    budget: Math.max(0, params.budget),
    action: 0,
  };
}

function stepLiveState(prev: LiveState, params: MDPParameters): LiveState {
  const N = Math.max(1, params.population);
  let action = choosePolicyAction(prev.I / N, prev.budget, params);
  if (actionCost(action, params) > prev.budget) action = 0;

  const spent = actionCost(action, params);
  const betaEff = params.beta * actionBetaMultiplier(action);
  const vaccRate = actionVaccinationRate(action);

  const vaccinated = Math.min(prev.S, vaccRate * prev.S);
  const sAfterVax = prev.S - vaccinated;
  const rAfterVax = prev.R + vaccinated;

  const newInfections = Math.min(sAfterVax, betaEff * (sAfterVax * prev.I / N));
  const totalOutRate = Math.max(0, params.gamma + params.mu);
  const totalOut = Math.min(prev.I, totalOutRate * prev.I);
  const newRecoveries = totalOutRate > 0 ? totalOut * (params.gamma / totalOutRate) : 0;
  const newDeaths = totalOutRate > 0 ? totalOut * (params.mu / totalOutRate) : 0;

  let sNext = Math.max(0, sAfterVax - newInfections);
  let iNext = Math.max(0, prev.I + newInfections - newRecoveries - newDeaths);
  let rNext = Math.max(0, rAfterVax + newRecoveries);
  const dNext = clamp(prev.D + newDeaths, 0, N);

  const livingTarget = Math.max(0, N - dNext);
  const livingTotal = sNext + iNext + rNext;
  if (livingTotal > 0) {
    const scale = livingTarget / livingTotal;
    sNext *= scale;
    iNext *= scale;
    rNext *= scale;
  } else {
    sNext = 0;
    iNext = 0;
    rNext = 0;
  }

  return {
    t: prev.t + 1,
    S: sNext,
    I: iNext,
    R: rNext,
    D: dNext,
    budget: Math.max(0, prev.budget - spent),
    action,
  };
}

function toGroundStatus(infectedRatio: number, deceasedRatio: number): GroundStatus {
  if (deceasedRatio >= 0.12 || infectedRatio >= 0.28) return "Failed State";
  if (infectedRatio >= 0.14) return "Out of Control";
  if (infectedRatio >= 0.06) return "Strained";
  if (infectedRatio >= 0.02) return "Watch";
  return "Controlled";
}

export function UtilitySpreadSurface({
  params,
  visualizationMode,
  onResetSimulation,
}: UtilitySpreadSurfaceProps) {
  const [artifactHistory, setArtifactHistory] = useState<ArtifactHistoryPoint[]>([]);
  const [artifactIndex, setArtifactIndex] = useState(0);
  const [liveState, setLiveState] = useState<LiveState>(() => buildInitialLiveState(params));

  useEffect(() => {
    let cancelled = false;

    const loadArtifactHistory = async () => {
      try {
        const response = await fetch("/api/training-data", { cache: "no-store" });
        const payload = await response.json();
        const history = Array.isArray(payload?.best_episode_history)
          ? (payload.best_episode_history as ArtifactHistoryPoint[])
          : [];
        if (!cancelled) {
          setArtifactHistory(history);
          setArtifactIndex(0);
        }
      } catch {
        if (!cancelled) {
          setArtifactHistory([]);
          setArtifactIndex(0);
        }
      }
    };

    void loadArtifactHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (visualizationMode !== "artifact") return undefined;
    if (artifactHistory.length <= 1) return undefined;

    const intervalId = window.setInterval(() => {
      setArtifactIndex((value) => (value + 1) % artifactHistory.length);
    }, 240);

    return () => window.clearInterval(intervalId);
  }, [artifactHistory, visualizationMode]);

  useEffect(() => {
    if (visualizationMode === "artifact") return undefined;

    const intervalId = window.setInterval(() => {
      setLiveState((current) => stepLiveState(current, params));
    }, 240);

    return () => window.clearInterval(intervalId);
  }, [params, visualizationMode]);

  const source = useMemo(() => {
    if (visualizationMode === "artifact" && artifactHistory.length > 0) {
      const point = artifactHistory[artifactIndex % artifactHistory.length];
      return {
        t: Number(point?.t ?? 0),
        S: Number(point?.state?.S ?? 0),
        I: Number(point?.state?.I ?? params.initialInfected),
        R: Number(point?.state?.R ?? 0),
        D: Number(point?.state?.D ?? params.initialDeceased),
        budget: Number(point?.state?.budget_remaining ?? params.budget),
        action: Number(point?.action_effective ?? 0),
      };
    }
    return liveState;
  }, [
    artifactHistory,
    artifactIndex,
    liveState,
    params.budget,
    params.initialDeceased,
    params.initialInfected,
    visualizationMode,
  ]);

  const infectedRatio = clamp(source.I / Math.max(1, params.population), 0, 1);
  const deceasedRatio = clamp(source.D / Math.max(1, params.population), 0, 1);
  const recoveredRatio = clamp(source.R / Math.max(1, params.population), 0, 1);
  const susceptibleRatio = clamp(source.S / Math.max(1, params.population), 0, 1);
  const groundStatus = toGroundStatus(infectedRatio, deceasedRatio);

  const policyState = useMemo<PolicyState>(() => {
    const action = source.action;
    if (action === 2) return "lockdown";
    if (action === 1) return "social_distancing";
    if (action === 3) return "vaccination";
    return "no_intervention";
  }, [source.action]);

  const statusTone =
    groundStatus === "Failed State"
      ? "#d65f5f"
      : groundStatus === "Out of Control"
        ? "#e79561"
        : groundStatus === "Strained"
          ? "#e2bf61"
          : groundStatus === "Watch"
            ? "#9ab863"
            : "#6dc79d";

  return (
    <section className="rounded-2xl border border-app-panel-border bg-app-panel p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-app-muted">Primary Dashboard</p>
          <h2 className="text-base font-semibold">Simulation Command Surface</h2>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-app-muted">
            Source: {visualizationMode === "artifact" && artifactHistory.length > 0 ? "training artifact" : "live SIRD"}
          </p>
          <button
            type="button"
            onClick={() => {
              setArtifactIndex(0);
              setLiveState(buildInitialLiveState(params));
              onResetSimulation();
            }}
            className="rounded-full border border-app-panel-border bg-app px-4 py-1.5 text-xs"
          >
            Reset Simulation
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-app-panel-border bg-[#050505] p-3 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="rounded-xl border border-app-panel-border bg-app p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Day Counter</p>
          <p className="mt-1 text-2xl font-semibold">Day {source.t}</p>
          <p className="mt-2 text-xs text-app-muted">
            Policy: {policyState.replace("_", " ").replace("_", " ")}
          </p>
        </div>

        <div className="rounded-xl border border-app-panel-border bg-app p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Ground Status</p>
          <p className="mt-1 text-lg font-semibold" style={{ color: statusTone }}>
            {groundStatus}
          </p>
          <p className="mt-2 text-xs text-app-muted">
            I={(infectedRatio * 100).toFixed(1)}% | D={(deceasedRatio * 100).toFixed(1)}%
          </p>
        </div>

        <div className="rounded-xl border border-app-panel-border bg-app p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Population Mix</p>
          <p className="mt-1 text-sm text-[#9ed1b8]">S {(susceptibleRatio * 100).toFixed(1)}%</p>
          <p className="text-sm text-[#e08a8a]">I {(infectedRatio * 100).toFixed(1)}%</p>
          <p className="text-sm text-[#95bfe8]">R {(recoveredRatio * 100).toFixed(1)}%</p>
          <p className="text-sm text-[#999999]">D {(deceasedRatio * 100).toFixed(1)}%</p>
        </div>

        <div className="rounded-xl border border-app-panel-border bg-app p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Resources</p>
          <p className="mt-1 text-sm">Budget Remaining {source.budget.toFixed(1)}</p>
          <p className="text-sm">Population {params.population}</p>
          <p className="text-sm">Horizon {params.horizon}</p>
        </div>
      </div>
    </section>
  );
}
