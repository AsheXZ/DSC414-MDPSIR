"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import {
  DEFAULT_MDP_PARAMETERS,
  type MDPParameters,
} from "@/components/mdp-params";
import type { VisualizationMode } from "@/components/epidemic-visualization";
import { ParameterControlPanel } from "@/components/parameter-control-panel";
import { UtilitySpreadSurface } from "@/components/utility-spread-surface";

const EpidemicVisualization = dynamic(
  () => import("@/components/epidemic-visualization").then((mod) => mod.EpidemicVisualization),
  { ssr: false },
);

export function ParameterWorkbench() {
  const [draftParams, setDraftParams] = useState<MDPParameters>(DEFAULT_MDP_PARAMETERS);
  const [appliedParams, setAppliedParams] = useState<MDPParameters>(DEFAULT_MDP_PARAMETERS);
  const [resetSignal, setResetSignal] = useState(0);
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>("simulation");

  const simulationInstanceKey = useMemo(
    () => `${resetSignal}:${JSON.stringify(appliedParams)}`,
    [appliedParams, resetSignal],
  );

  const hasPendingChanges = useMemo(
    () => JSON.stringify(draftParams) !== JSON.stringify(appliedParams),
    [draftParams, appliedParams],
  );

  const applyParameters = () => {
    setAppliedParams(draftParams);
  };

  const derived = useMemo(() => {
    const susceptible = Math.max(
      0,
      appliedParams.population -
        appliedParams.initialInfected -
        appliedParams.initialRecovered -
        appliedParams.initialDeceased,
    );
    const totalInterventionCost =
      appliedParams.costs.noIntervention +
      appliedParams.costs.socialDistancing +
      appliedParams.costs.lockdown +
      appliedParams.costs.vaccinationCampaign;

    return {
      susceptible,
      totalInterventionCost,
      r0:
        appliedParams.gamma + appliedParams.mu > 0
          ? appliedParams.beta / (appliedParams.gamma + appliedParams.mu)
          : 0,
    };
  }, [appliedParams]);

  return (
    <section className="grid gap-3">
      <UtilitySpreadSurface
        key={`dashboard-${simulationInstanceKey}`}
        params={appliedParams}
        visualizationMode={visualizationMode}
        onResetSimulation={() => setResetSignal((value) => value + 1)}
      />

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <ParameterControlPanel
            params={draftParams}
            onChange={setDraftParams}
            hasPendingChanges={hasPendingChanges}
            onApply={applyParameters}
          />
        </aside>

        <div className="space-y-3">
          <EpidemicVisualization
            key={`viz-${simulationInstanceKey}`}
            params={appliedParams}
            onModeChange={setVisualizationMode}
          />

          <aside className="rounded-2xl border border-app-panel-border bg-app-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-app-muted">Applied Scenario</p>
              <h2 className="text-lg font-semibold">Current Payload</h2>
            </div>
            <div className="rounded-full border border-app-panel-border bg-app px-4 py-2 text-xs">
              R0 <span className="font-semibold">{derived.r0.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Susceptible</p>
              <p className="font-semibold">{derived.susceptible}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Infected</p>
              <p className="font-semibold">{appliedParams.initialInfected}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Budget</p>
              <p className="font-semibold">{appliedParams.budget.toFixed(0)}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Horizon</p>
              <p className="font-semibold">{appliedParams.horizon}</p>
            </div>
          </div>

          <p className="mt-3 text-sm text-app-muted">
            Total intervention cost index: {derived.totalInterventionCost.toFixed(0)}
          </p>

          <pre className="mt-3 max-h-[220px] overflow-auto rounded-xl border border-app-panel-border bg-[#070707] p-3 font-mono text-xs text-[#d6e5f7]">
            {JSON.stringify(appliedParams, null, 2)}
          </pre>
          </aside>
        </div>
      </div>
    </section>
  );
}
