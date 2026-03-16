"use client";

import type { MDPParameters } from "@/components/mdp-params";

type ParameterControlPanelProps = {
  params: MDPParameters;
  onChange: (next: MDPParameters) => void;
  hasPendingChanges: boolean;
  onApply: () => void;
};

type ControlRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onValueChange: (value: number) => void;
};

function ControlRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onValueChange,
}: ControlRowProps) {
  return (
    <label className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-[0.14em] uppercase text-app-muted">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Number.isFinite(value) ? value : min}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onValueChange(Number(event.target.value))}
            className="w-24 rounded-lg border border-app-panel-border bg-app px-2 py-1 text-right text-sm text-app-fg outline-none ring-0 transition focus:border-emerald-600 dark:focus:border-cyan-300"
          />
          <span className="w-8 text-xs text-app-muted">{unit ?? ""}</span>
        </div>
      </div>
      <input
        type="range"
        value={Number.isFinite(value) ? value : min}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-emerald-900/20 accent-emerald-600 dark:accent-cyan-300"
      />
    </label>
  );
}

export function ParameterControlPanel({
  params,
  onChange,
  hasPendingChanges,
  onApply,
}: ParameterControlPanelProps) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const update = <K extends keyof MDPParameters>(key: K, value: MDPParameters[K]) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <section className="rounded-3xl border border-app-panel-border bg-app-panel p-6 shadow-[0_12px_45px_rgba(16,35,30,0.08)] backdrop-blur-md dark:shadow-[0_16px_50px_rgba(2,8,8,0.35)]">
      <h2 className="text-lg font-semibold">Parameter Controls</h2>
      <p className="mt-1 text-sm text-app-muted">
        Adjust epidemic and policy assumptions. These values are kept in shared state and ready for visualization.
      </p>

      <div className="mt-6 grid gap-5">
        <ControlRow
          label="Population"
          value={params.population}
          min={100}
          max={100000}
          step={100}
          onValueChange={(value) => {
            const nextPopulation = clamp(Math.round(value), 100, 100000);
            const maxI = nextPopulation;
            const maxR = nextPopulation;
            const nextInfected = clamp(params.initialInfected, 0, maxI);
            const nextRecovered = clamp(params.initialRecovered, 0, maxR);
            onChange({
              ...params,
              population: nextPopulation,
              initialInfected: nextInfected,
              initialRecovered: nextRecovered,
            });
          }}
        />

        <ControlRow
          label="Initial Infected"
          value={params.initialInfected}
          min={0}
          max={params.population}
          step={1}
          onValueChange={(value) =>
            update("initialInfected", clamp(Math.round(value), 0, params.population))
          }
        />

        <ControlRow
          label="Initial Recovered"
          value={params.initialRecovered}
          min={0}
          max={params.population}
          step={1}
          onValueChange={(value) =>
            update("initialRecovered", clamp(Math.round(value), 0, params.population))
          }
        />

        <ControlRow
          label="Budget"
          value={params.budget}
          min={0}
          max={5000}
          step={10}
          onValueChange={(value) => update("budget", clamp(value, 0, 5000))}
        />

        <ControlRow
          label="Infection Rate (beta)"
          value={params.beta}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => update("beta", clamp(value, 0, 1))}
        />

        <ControlRow
          label="Recovery Rate (gamma)"
          value={params.gamma}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => update("gamma", clamp(value, 0, 1))}
        />
      </div>

      <hr className="my-6 border-app-panel-border" />

      <h3 className="text-sm font-semibold tracking-[0.14em] uppercase text-app-muted">Intervention Costs</h3>
      <div className="mt-4 grid gap-5">
        <ControlRow
          label="No Intervention"
          value={params.costs.noIntervention}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) =>
            onChange({
              ...params,
              costs: { ...params.costs, noIntervention: clamp(value, 0, 100) },
            })
          }
        />

        <ControlRow
          label="Social Distancing"
          value={params.costs.socialDistancing}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) =>
            onChange({
              ...params,
              costs: { ...params.costs, socialDistancing: clamp(value, 0, 100) },
            })
          }
        />

        <ControlRow
          label="Lockdown"
          value={params.costs.lockdown}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) =>
            onChange({
              ...params,
              costs: { ...params.costs, lockdown: clamp(value, 0, 100) },
            })
          }
        />

        <ControlRow
          label="Vaccination Campaign"
          value={params.costs.vaccinationCampaign}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) =>
            onChange({
              ...params,
              costs: { ...params.costs, vaccinationCampaign: clamp(value, 0, 100) },
            })
          }
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-panel-border bg-app p-3">
        <p className="text-xs text-app-muted">
          Changes are staged until applied.
        </p>
        <button
          type="button"
          onClick={onApply}
          disabled={!hasPendingChanges}
          className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-5 py-2 text-xs font-semibold tracking-[0.12em] uppercase text-emerald-700 transition enabled:hover:scale-[1.02] enabled:hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-300/50 dark:bg-cyan-300/10 dark:text-cyan-200"
        >
          Apply And Restart
        </button>
      </div>
    </section>
  );
}
