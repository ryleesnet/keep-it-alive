import { formatSeconds } from "@/lib/format";

export function buildPosts(input: {
  seconds: number;
  near: number;
  link: string;
  mention?: string;
  beaten?: { username?: string; score: number };
}): { deso: string; x: string } {
  const time = formatSeconds(input.seconds);
  const near = Math.max(0, Math.round(input.near));
  const mention = input.mention?.replace(/^@/, "");
  const lines = [
    `I kept it alive for ${time} seconds in KEEP IT ALIVE.`,
    "",
    `Near misses: ${near}.`,
  ];

  if (input.beaten) {
    const who = input.beaten.username
      ? `@${input.beaten.username.replace(/^@/, "")}`
      : "The last mark";
    lines.push(`${who} held ${formatSeconds(input.beaten.score)}s. I went longer.`);
    lines.push(mention ? `@${mention} — can you take the lead?` : "Can you top it?");
  } else if (mention) {
    lines.push(`@${mention} — can you beat ${time}s?`);
  } else {
    lines.push("Can you beat me?");
  }

  lines.push("", input.link, "", "#KeepItAlive");

  const beatenLine = input.beaten
    ? `I lasted ${time}s in KEEP IT ALIVE and beat ${formatSeconds(input.beaten.score)}s. Can you top it?\n${input.link}`
    : `I kept it alive for ${time}s in KEEP IT ALIVE. Can you beat me?\n${input.link}`;

  const xCandidates = [
    beatenLine,
    `KEEP IT ALIVE: ${time}s. Beat me?\n${input.link}`,
    `${time}s on KEEP IT ALIVE. Beat me: ${input.link}`,
  ];

  return {
    deso: lines.join("\n"),
    x: xCandidates.find((candidate) => candidate.length <= 280) ?? xCandidates[2],
  };
}
