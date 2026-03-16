"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import {
  DEFAULT_MDP_PARAMETERS,
  type MDPParameters,
} from "@/components/mdp-params";
import { ParameterControlPanel } from "@/components/parameter-control-panel";

const EpidemicVisualization = dynamic(
  () => import("@/components/epidemic-visualization").then((mod) => mod.EpidemicVisualization),
  { ssr: false },
);

export function ParameterWorkbench() {
  const [draftParams, setDraftParams] = useState<MDPParameters>(DEFAULT_MDP_PARAMETERS);
  const [appliedParams, setAppliedParams] = useState<MDPParameters>(DEFAULT_MDP_PARAMETERS);
  const [resetSignal, setResetSignal] = useState(0);

  const hasPendingChanges = useMemo(
    () => JSON.stringify(draftParams) !== JSON.stringify(appliedParams),
    [draftParams, appliedParams],
  );

  const applyParameters = () => {
    setAppliedParams(draftParams);
    setResetSignal((value) => value + 1);
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
    };
  }, [appliedParams]);

  return (
    <section className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ParameterControlPanel
          params={draftParams}
          onChange={setDraftParams}
          hasPendingChanges={hasPendingChanges}
          onApply={applyParameters}
        />

        <aside className="rounded-3xl border border-app-panel-border bg-app-panel p-6 backdrop-blur-md">
          <h2 className="text-lg font-semibold">Applied State Payload</h2>
          <p className="mt-1 text-sm text-app-muted">
            Visualization reads this applied snapshot. Modify controls, then press apply.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Susceptible</p>
              <p className="text-base font-semibold">{derived.susceptible}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Infected</p>
              <p className="text-base font-semibold">{appliedParams.initialInfected}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Recovered</p>
              <p className="text-base font-semibold">{appliedParams.initialRecovered}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Deceased</p>
              <p className="text-base font-semibold">{appliedParams.initialDeceased}</p>
            </div>
            <div className="rounded-xl border border-app-panel-border bg-app px-3 py-2">
              <p className="text-app-muted">Budget</p>
              <p className="text-base font-semibold">{appliedParams.budget.toFixed(0)}</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-app-panel-border bg-app px-3 py-2">
            <p className="text-sm text-app-muted">Sum of action costs</p>
            <p className="text-base font-semibold">{derived.totalInterventionCost.toFixed(0)}</p>
          </div>

          <pre className="mt-4 max-h-[250px] overflow-auto rounded-xl border border-app-panel-border bg-[#10211d] p-3 font-mono text-xs text-[#d6ece4] dark:bg-[#071210]">
            {JSON.stringify(appliedParams, null, 2)}
          </pre>
        </aside>
      </div>

      <EpidemicVisualization key={resetSignal} params={appliedParams} />
    </section>
  );
}
