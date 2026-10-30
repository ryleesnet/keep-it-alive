import { connection, NextRequest, NextResponse } from "next/server";
import { listHighScores, saveHighScore } from "@/lib/high-score-store";

export async function GET() {
  await connection();
  const scores = await listHighScores();
  return NextResponse.json({
    scores: scores.slice(0, 50).map((score) => ({
      id: score.id,
      name: score.name,
      seconds: score.seconds,
      near: score.near,
      updatedAt: score.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  await connection();
  let body: {
    seconds?: unknown;
    near?: unknown;
    name?: unknown;
    publicKey?: unknown;
    playerId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Score details are required." }, { status: 400 });
  }

  try {
    const score = await saveHighScore({
      seconds: typeof body.seconds === "number" ? body.seconds : Number.NaN,
      near: typeof body.near === "number" ? body.near : Number(body.near ?? 0),
      name: typeof body.name === "string" ? body.name : undefined,
      publicKey: typeof body.publicKey === "string" ? body.publicKey : undefined,
      playerId: typeof body.playerId === "string" ? body.playerId : undefined,
    });
    return NextResponse.json({ score });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't save that score.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
