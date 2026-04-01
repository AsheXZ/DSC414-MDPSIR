import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from tqdm import trange


@dataclass
class EnvConfig:
    population: int = 1000
    beta: float = 0.30
    gamma: float = 0.10
    mu: float = 0.01
    randomize_disease_params: bool = True
    beta_range: Tuple[float, float] = (0.15, 0.50)
    gamma_range: Tuple[float, float] = (0.05, 0.20)
    initial_infected: int = 10
    initial_recovered: int = 0
    initial_deceased: int = 0
    horizon: int = 300
    budget: float = 300.0
    reward_infection_weight: float = 1.0
    reward_death_weight: float = 2.0
    reward_action_weight: float = 0.05
    # Moderate defaults improve state coverage while remaining configurable.
    s_bins: int = 6
    i_bins: int = 6
    r_bins: int = 6
    d_bins: int = 6
    budget_bins: int = 8
    beta_bins: int = 5
    gamma_bins: int = 5
    reward_eradication_bonus: float = 0.25


class SIRBudgetEnv(gym.Env):
    """
    Gymnasium environment for SIR epidemic control with budget-constrained interventions.

    Action mapping:
      0: No intervention
      1: Social distancing
      2: Lockdown
      3: Vaccination campaign
    """

    metadata = {"render_modes": []}

    def __init__(self, config: Optional[EnvConfig] = None):
        super().__init__()
        self.config = config or EnvConfig()
        self.N = float(self.config.population)

        self.action_effects = {
            0: {"beta_multiplier": 1.00, "cost": 0.0, "vaccination_rate": 0.0},
            1: {"beta_multiplier": 0.75, "cost": 2.0, "vaccination_rate": 0.0},
            2: {"beta_multiplier": 0.45, "cost": 5.0, "vaccination_rate": 0.0},
            3: {"beta_multiplier": 0.85, "cost": 3.0, "vaccination_rate": 0.02},
        }
        self.action_count = len(self.action_effects)

        self.action_space = spaces.Discrete(4)
        # Observation is continuous S, I, R, D, remaining_budget, beta, gamma.
        self.observation_space = spaces.Box(
            low=np.array(
                [
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    min(self.config.beta_range),
                    min(self.config.gamma_range),
                ],
                dtype=np.float32,
            ),
            high=np.array(
                [
                    self.N,
                    self.N,
                    self.N,
                    self.N,
                    self.config.budget,
                    max(self.config.beta_range),
                    max(self.config.gamma_range),
                ],
                dtype=np.float32,
            ),
            dtype=np.float32,
        )

        self.S = 0.0
        self.I = 0.0
        self.R = 0.0
        self.D = 0.0
        self.remaining_budget = 0.0
        self.t = 0
        self.current_beta = float(self.config.beta)
        self.current_gamma = float(self.config.gamma)

    def _sample_disease_params(self) -> None:
        if self.config.randomize_disease_params:
            # Use Gymnasium-managed RNG so per-episode seeding is reproducible.
            self.current_beta = float(self.np_random.uniform(*self.config.beta_range))
            self.current_gamma = float(self.np_random.uniform(*self.config.gamma_range))
        else:
            self.current_beta = float(self.config.beta)
            self.current_gamma = float(self.config.gamma)

    def _get_obs(self) -> np.ndarray:
        return np.array(
            [
                self.S,
                self.I,
                self.R,
                self.D,
                self.remaining_budget,
                self.current_beta,
                self.current_gamma,
            ],
            dtype=np.float32,
        )

    def _discretize_state(self, obs: np.ndarray) -> Tuple[int, int, int, int, int, int, int]:
        s_ratio = obs[0] / self.N
        i_ratio = obs[1] / self.N
        r_ratio = obs[2] / self.N
        d_ratio = obs[3] / self.N
        b_ratio = obs[4] / max(1e-9, self.config.budget)
        beta_ratio = (obs[5] - self.config.beta_range[0]) / max(
            1e-9, self.config.beta_range[1] - self.config.beta_range[0]
        )
        gamma_ratio = (obs[6] - self.config.gamma_range[0]) / max(
            1e-9, self.config.gamma_range[1] - self.config.gamma_range[0]
        )

        s_idx = min(self.config.s_bins - 1, max(0, int(s_ratio * self.config.s_bins)))
        i_idx = min(self.config.i_bins - 1, max(0, int(i_ratio * self.config.i_bins)))
        r_idx = min(self.config.r_bins - 1, max(0, int(r_ratio * self.config.r_bins)))
        d_idx = min(self.config.d_bins - 1, max(0, int(d_ratio * self.config.d_bins)))
        b_bins = self.config.budget_bins
        b_idx = min(b_bins - 1, max(0, int(b_ratio * b_bins)))
        beta_idx = min(self.config.beta_bins - 1, max(0, int(beta_ratio * self.config.beta_bins)))
        gamma_idx = min(
            self.config.gamma_bins - 1,
            max(0, int(gamma_ratio * self.config.gamma_bins)),
        )
        return s_idx, i_idx, r_idx, d_idx, b_idx, beta_idx, gamma_idx

    def reset(self, *, seed: Optional[int] = None, options: Optional[Dict] = None):
        super().reset(seed=seed)
        self.S = float(
            self.config.population
            - self.config.initial_infected
            - self.config.initial_recovered
            - self.config.initial_deceased
        )
        self.S = max(0.0, self.S)
        self.I = float(self.config.initial_infected)
        self.R = float(self.config.initial_recovered)
        self.D = float(self.config.initial_deceased)
        self.remaining_budget = float(self.config.budget)
        self.t = 0
        self._sample_disease_params()

        obs = self._get_obs()
        info = {"state_disc": self._discretize_state(obs)}
        return obs, info

    def step(self, action: int):
        assert self.action_space.contains(action), f"Invalid action {action}"

        action_spec = self.action_effects[action]
        requested_cost = float(action_spec["cost"])

        # Enforce budget constraint by falling back to no intervention when needed.
        if requested_cost > self.remaining_budget:
            effective_action = 0
            action_spec = self.action_effects[0]
            incurred_cost = 0.0
            budget_violation = True
        else:
            effective_action = action
            incurred_cost = requested_cost
            budget_violation = False

        beta_eff = self.current_beta * float(action_spec["beta_multiplier"])
        vacc_rate = float(action_spec["vaccination_rate"])

        # Vaccination directly moves a share of susceptible to recovered.
        vaccinated = min(self.S, vacc_rate * self.S)
        S_after_vax = self.S - vaccinated
        R_after_vax = self.R + vaccinated

        # Core SIRD dynamics with bounded transitions.
        new_infections = min(S_after_vax, beta_eff * (S_after_vax * self.I / self.N))

        total_out_rate = max(0.0, self.current_gamma + self.config.mu)
        total_out = min(self.I, total_out_rate * self.I)
        if total_out_rate > 0:
            new_recoveries = total_out * (self.current_gamma / total_out_rate)
            new_deaths = total_out * (self.config.mu / total_out_rate)
        else:
            new_recoveries = 0.0
            new_deaths = 0.0

        S_next = S_after_vax - new_infections
        I_next = self.I + new_infections - new_recoveries - new_deaths
        R_next = R_after_vax + new_recoveries
        D_next = self.D + new_deaths

        # Numerical guardrails and conservation without reviving deceased population.
        S_next = max(0.0, S_next)
        I_next = max(0.0, I_next)
        R_next = max(0.0, R_next)
        D_next = min(self.N, max(0.0, D_next))
        living_target = max(0.0, self.N - D_next)
        living_total = S_next + I_next + R_next
        if living_total > 0:
            scale = living_target / living_total
            S_next *= scale
            I_next *= scale
            R_next *= scale
        else:
            S_next = 0.0
            I_next = 0.0
            R_next = 0.0

        self.S, self.I, self.R, self.D = S_next, I_next, R_next, D_next
        self.remaining_budget = max(0.0, self.remaining_budget - incurred_cost)
        self.t += 1

        infection_penalty = self.config.reward_infection_weight * (self.I / self.N)
        death_penalty = self.config.reward_death_weight * (new_deaths / self.N)
        action_penalty = self.config.reward_action_weight * (incurred_cost / max(1.0, self.config.budget))
        reward = -(infection_penalty + death_penalty + action_penalty)

        terminated = self.I < 1e-3
        if terminated:
            reward += self.config.reward_eradication_bonus
        truncated = self.t >= self.config.horizon

        obs = self._get_obs()
        info = {
            "effective_action": effective_action,
            "incurred_cost": incurred_cost,
            "budget_violation": budget_violation,
            "deaths_this_step": new_deaths,
            "cumulative_deaths": self.D,
            "episode_beta": self.current_beta,
            "episode_gamma": self.current_gamma,
            "state_disc": self._discretize_state(obs),
        }
        return obs, reward, terminated, truncated, info


@dataclass
class QLearningConfig:
    episodes: int = 100000
    alpha: float = 0.15
    gamma: float = 0.97
    epsilon_start: float = 1.0
    epsilon_end: float = 0.05
    # ~0.05 by the end of a 100k episode run (instead of by episode ~596).
    epsilon_decay: float = 0.99997
    seed: int = 42


class QLearningAgent:
    def __init__(self, env: SIRBudgetEnv, cfg: Optional[QLearningConfig] = None):
        self.env = env
        self.cfg = cfg or QLearningConfig()

        random.seed(self.cfg.seed)
        np.random.seed(self.cfg.seed)

        self.b_bins = self.env.config.budget_bins
        self.q_table = np.zeros(
            (
                self.env.config.s_bins,
                self.env.config.i_bins,
                self.env.config.r_bins,
                self.env.config.d_bins,
                self.b_bins,
                self.env.config.beta_bins,
                self.env.config.gamma_bins,
                self.env.action_count,
            ),
            dtype=np.float32,
        )

    def _select_action(self, state_disc: Tuple[int, int, int, int, int, int, int], epsilon: float) -> int:
        if random.random() < epsilon:
            return self.env.action_space.sample()
        s_idx, i_idx, r_idx, d_idx, b_idx, beta_idx, gamma_idx = state_disc
        q_vals = self.q_table[s_idx, i_idx, r_idx, d_idx, b_idx, beta_idx, gamma_idx, :]
        return int(np.argmax(q_vals))

    def train(self) -> Dict:
        epsilon = self.cfg.epsilon_start
        episode_rewards: List[float] = []
        best_history: List[Dict] = []
        best_reward = -math.inf

        progress = trange(self.cfg.episodes, desc="Training episodes", unit="ep")
        for episode in progress:
            obs, info = self.env.reset(seed=self.cfg.seed + episode)
            state_disc = info["state_disc"]

            done = False
            total_reward = 0.0
            episode_history: List[Dict] = []

            while not done:
                action = self._select_action(state_disc, epsilon)
                next_obs, reward, terminated, truncated, step_info = self.env.step(action)
                next_state_disc = step_info["state_disc"]

                s_idx, i_idx, r_idx, d_idx, b_idx, beta_idx, gamma_idx = state_disc
                ns_idx, ni_idx, nr_idx, nd_idx, nb_idx, nbeta_idx, ngamma_idx = next_state_disc

                # Learn a value for the requested action, even if the env had to
                # substitute a different effective action due to budget limits.
                current_q = self.q_table[
                    s_idx,
                    i_idx,
                    r_idx,
                    d_idx,
                    b_idx,
                    beta_idx,
                    gamma_idx,
                    action,
                ]
                max_next_q = np.max(
                    self.q_table[
                        ns_idx,
                        ni_idx,
                        nr_idx,
                        nd_idx,
                        nb_idx,
                        nbeta_idx,
                        ngamma_idx,
                        :,
                    ]
                )
                td_target = reward + self.cfg.gamma * max_next_q
                td_error = td_target - current_q
                self.q_table[
                    s_idx,
                    i_idx,
                    r_idx,
                    d_idx,
                    b_idx,
                    beta_idx,
                    gamma_idx,
                    action,
                ] = current_q + self.cfg.alpha * td_error

                episode_history.append(
                    {
                        "t": int(self.env.t),
                        "state": {
                            "S": float(obs[0]),
                            "I": float(obs[1]),
                            "R": float(obs[2]),
                            "D": float(obs[3]),
                            "budget_remaining": float(obs[4]),
                            "beta": float(obs[5]),
                            "gamma": float(obs[6]),
                        },
                        "state_discrete": {
                            "s_bin": int(s_idx),
                            "i_bin": int(i_idx),
                            "r_bin": int(r_idx),
                            "d_bin": int(d_idx),
                            "budget_bin": int(b_idx),
                            "beta_bin": int(beta_idx),
                            "gamma_bin": int(gamma_idx),
                        },
                        "action_requested": int(action),
                        "action_effective": int(step_info["effective_action"]),
                        "cost": float(step_info["incurred_cost"]),
                        "budget_violation": bool(step_info["budget_violation"]),
                        "reward": float(reward),
                    }
                )

                obs = next_obs
                state_disc = next_state_disc
                total_reward += reward
                done = terminated or truncated

            episode_rewards.append(total_reward)
            if total_reward > best_reward:
                best_reward = total_reward
                best_history = episode_history

            epsilon = max(self.cfg.epsilon_end, epsilon * self.cfg.epsilon_decay)

            if episode % 100 == 0 or episode == self.cfg.episodes - 1:
                progress.set_postfix(
                    {
                        "reward": f"{total_reward:.4f}",
                        "best": f"{best_reward:.4f}",
                        "eps": f"{epsilon:.4f}",
                    }
                )

        return {
            "episode_rewards": episode_rewards,
            "best_episode_reward": best_reward,
            "best_episode_history": best_history,
            "final_epsilon": epsilon,
        }


def export_training_artifacts(
    export_dir: Path,
    env_cfg: EnvConfig,
    agent_cfg: QLearningConfig,
    q_table: np.ndarray,
    summary: Dict,
) -> None:
    export_dir.mkdir(parents=True, exist_ok=True)

    q_table_payload = {
        "shape": list(q_table.shape),
        "values": q_table.tolist(),
        "action_mapping": {
            "0": "no_intervention",
            "1": "social_distancing",
            "2": "lockdown",
            "3": "vaccination_campaign",
        },
        "state_bins": {
            "s_bins": env_cfg.s_bins,
            "i_bins": env_cfg.i_bins,
            "r_bins": env_cfg.r_bins,
            "d_bins": env_cfg.d_bins,
            "budget_bins": env_cfg.budget_bins,
            "beta_bins": env_cfg.beta_bins,
            "gamma_bins": env_cfg.gamma_bins,
        },
    }

    training_payload = {
        "environment": {
            "population": env_cfg.population,
            "beta": env_cfg.beta,
            "gamma": env_cfg.gamma,
            "mu": env_cfg.mu,
            "randomize_disease_params": env_cfg.randomize_disease_params,
            "beta_range": list(env_cfg.beta_range),
            "gamma_range": list(env_cfg.gamma_range),
            "initial_infected": env_cfg.initial_infected,
            "initial_recovered": env_cfg.initial_recovered,
            "initial_deceased": env_cfg.initial_deceased,
            "horizon": env_cfg.horizon,
            "budget": env_cfg.budget,
            "budget_bins": env_cfg.budget_bins,
            "reward_eradication_bonus": env_cfg.reward_eradication_bonus,
        },
        "agent": {
            "episodes": agent_cfg.episodes,
            "alpha": agent_cfg.alpha,
            "gamma": agent_cfg.gamma,
            "epsilon_start": agent_cfg.epsilon_start,
            "epsilon_end": agent_cfg.epsilon_end,
            "epsilon_decay": agent_cfg.epsilon_decay,
            "seed": agent_cfg.seed,
        },
        "best_episode_reward": summary["best_episode_reward"],
        "final_epsilon": summary["final_epsilon"],
        "episode_rewards": summary["episode_rewards"],
        "best_episode_history": summary["best_episode_history"],
    }

    (export_dir / "q_table.json").write_text(json.dumps(q_table_payload, indent=2), encoding="utf-8")
    (export_dir / "training_run.json").write_text(json.dumps(training_payload, indent=2), encoding="utf-8")


def main() -> None:
    env_cfg = EnvConfig()
    agent_cfg = QLearningConfig()

    env = SIRBudgetEnv(config=env_cfg)
    agent = QLearningAgent(env=env, cfg=agent_cfg)
    summary = agent.train()

    export_dir = Path(__file__).resolve().parent / "artifacts"
    export_training_artifacts(
        export_dir=export_dir,
        env_cfg=env_cfg,
        agent_cfg=agent_cfg,
        q_table=agent.q_table,
        summary=summary,
    )

    print(f"Training complete. Artifacts exported to: {export_dir}")


if __name__ == "__main__":
    main()
