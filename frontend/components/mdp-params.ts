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
  budget: number;
  beta: number;
  gamma: number;
  costs: InterventionCosts;
};

export const DEFAULT_MDP_PARAMETERS: MDPParameters = {
  population: 1000,
  initialInfected: 10,
  initialRecovered: 0,
  budget: 300,
  beta: 0.3,
  gamma: 0.1,
  costs: {
    noIntervention: 0,
    socialDistancing: 2,
    lockdown: 5,
    vaccinationCampaign: 3,
  },
};
