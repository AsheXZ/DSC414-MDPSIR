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
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ControlRow({ label, hint, value, min, max, step, onValueChange }: ControlRowProps) {
  const resolvedValue = Number.isFinite(value) ? value : min;

  return (
    <label className="grid gap-1.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] uppercase text-app-muted">{label}</p>
          {hint ? <p className="text-[11px] text-app-muted/80">{hint}</p> : null}
        </div>
        <input
          type="number"
          value={resolvedValue}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onValueChange(Number(event.target.value))}
          className="w-24 rounded-md border border-app-panel-border bg-app px-2 py-1 text-right text-sm outline-none focus:border-[#3e8dcf]"
        />
      </div>
      <input
        type="range"
        value={resolvedValue}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#cad4e2] accent-[#3e8dcf] dark:bg-[#293649]"
      />
    </label>
  );
}

function epidemiologyChecks(params: MDPParameters): string[] {
  const messages: string[] = [];
  const livingInitial =
    params.initialInfected + params.initialRecovered + params.initialDeceased;

  if (livingInitial > params.population) {
    messages.push("Initial compartments exceed population. Reduce infected/recovered/deceased totals.");
  }

  const totalOutRate = params.gamma + params.mu;
  if (totalOutRate > 1) {
    messages.push("gamma + mu is above 1.0 per step, which is aggressive for this discrete-time SIRD update.");
  }

  if (params.initialInfected === 0 && params.beta > 0) {
    messages.push("Initial infected is 0, so no outbreak can start in this closed-population model.");
  }

  if (params.budget <= 0 && params.costs.noIntervention < 0.00001) {
    messages.push("Budget is zero, so policy actions collapse to no-intervention only.");
  }

  return messages;
}

export function ParameterControlPanel({
  params,
  onChange,
  hasPendingChanges,
  onApply,
}: ParameterControlPanelProps) {
  const update = <K extends keyof MDPParameters>(key: K, value: MDPParameters[K]) => {
    onChange({ ...params, [key]: value });
  };

  const r0 = params.gamma + params.mu > 0 ? params.beta / (params.gamma + params.mu) : 0;
  const suitability = epidemiologyChecks(params);

  return (
    <section className="rounded-2xl border border-app-panel-border bg-app-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-app-muted">Scenario Builder</p>
          <h2 className="text-lg font-semibold">Design An Epidemic</h2>
        </div>
        <div className="rounded-full border border-app-panel-border bg-app px-4 py-2 text-xs">
          R0 estimate: <span className="font-semibold">{r0.toFixed(2)}</span>
        </div>
      </div>

      <p className="mt-2 text-sm text-app-muted">
        Controls are constrained to the SIRD assumptions used by the backend model.
      </p>

      <div className="mt-5 grid gap-4">
        <ControlRow
          label="Population"
          value={params.population}
          min={100}
          max={100000}
          step={100}
          onValueChange={(value) => {
            const population = clamp(Math.round(value), 100, 100000);
            onChange({
              ...params,
              population,
              initialInfected: clamp(params.initialInfected, 0, population),
              initialRecovered: clamp(params.initialRecovered, 0, population),
              initialDeceased: clamp(params.initialDeceased, 0, population),
            });
          }}
        />

        <ControlRow
          label="Horizon"
          hint="Simulation steps"
          value={params.horizon}
          min={30}
          max={360}
          step={5}
          onValueChange={(value) => update("horizon", clamp(Math.round(value), 30, 360))}
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
          label="Initial Deceased"
          value={params.initialDeceased}
          min={0}
          max={params.population}
          step={1}
          onValueChange={(value) =>
            update("initialDeceased", clamp(Math.round(value), 0, params.population))
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

        <ControlRow
          label="Mortality Rate (mu)"
          value={params.mu}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => update("mu", clamp(value, 0, 1))}
        />

        <ControlRow
          label="Cost: Social Distancing"
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
          label="Cost: Lockdown"
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
          label="Cost: Vaccination"
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

      <div className="mt-5 rounded-2xl border border-app-panel-border bg-app p-3 text-xs">
        <p className="font-medium uppercase tracking-[0.14em] text-app-muted">Model Suitability</p>
        {suitability.length === 0 ? (
          <p className="mt-2 text-[#4f9f7d]">Scenario is consistent with current SIRD assumptions.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5 text-[#d86d6d]">
            {suitability.map((issue) => (
              <li key={issue}>- {issue}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-app-panel-border bg-app p-3">
        <p className="text-xs text-app-muted">Changes are staged until applied.</p>
        <button
          type="button"
          onClick={onApply}
          disabled={!hasPendingChanges}
          className="rounded-full border border-app-panel-border bg-[#3e8dcf] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply Scenario
        </button>
      </div>
    </section>
  );
}
