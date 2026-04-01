export type InterventionCosts = {
  noIntervention: number;
  socialDistancing: number;
  lockdown: number;
  vaccinationCampaign: number;
};

export type MDPParameters = {
  population: number;
  initialInfected: number;
  initialRecovered: number;
  initialDeceased: number;
  horizon: number;
  budget: number;
  beta: number;
  gamma: number;
  mu: number;
  costs: InterventionCosts;
};

export const DEFAULT_MDP_PARAMETERS: MDPParameters = {
  population: 1000,
  initialInfected: 10,
  initialRecovered: 0,
  initialDeceased: 0,
  horizon: 180,
  budget: 300,
  beta: 0.3,
  gamma: 0.1,
  mu: 0.01,
  costs: {
    noIntervention: 0,
    socialDistancing: 2,
    lockdown: 5,
    vaccinationCampaign: 3,
  },
};
