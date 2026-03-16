import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    const qTablePath = path.resolve(
      process.cwd(),
      "..",
      "backend",
      "artifacts",
      "q_table.json",
    );

    const raw = await fs.readFile(qTablePath, "utf-8");
    const parsed = JSON.parse(raw);

    return NextResponse.json({
      source: "artifact",
      shape: parsed.shape ?? null,
      values: parsed.values ?? null,
      state_bins: parsed.state_bins ?? null,
      action_mapping: parsed.action_mapping ?? null,
    });
  } catch {
    return NextResponse.json(
      {
        source: "fallback",
        shape: null,
        values: null,
        state_bins: null,
        action_mapping: null,
      },
      { status: 200 },
    );
  }
}
