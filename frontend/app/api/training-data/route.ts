import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    const artifactPath = path.resolve(
      process.cwd(),
      "..",
      "backend",
      "artifacts",
      "training_run.json",
    );

    const raw = await fs.readFile(artifactPath, "utf-8");
    const parsed = JSON.parse(raw);

    return NextResponse.json({
      source: "artifact",
      environment: parsed.environment ?? null,
      best_episode_history: parsed.best_episode_history ?? [],
      best_episode_reward: parsed.best_episode_reward ?? null,
    });
  } catch {
    return NextResponse.json(
      {
        source: "fallback",
        environment: null,
        best_episode_history: [],
        best_episode_reward: null,
      },
      { status: 200 },
    );
  }
}
