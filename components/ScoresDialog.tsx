"use client";

import { useEffect, useState } from "react";
import { desoPostUrl } from "@/lib/constants";
import { challengeLink } from "@/lib/challenge";
import { formatSeconds, formatWhen } from "@/lib/format";
import type { DesoUser, PostedScore } from "@/lib/types";

export function ScoresDialog({
  user,
  onClose,
}: {
  user: DesoUser;
  onClose: () => void;
}) {
  const [scores, setScores] = useState<PostedScore[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/deso/scores?publicKey=${encodeURIComponent(user.publicKey)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as { scores?: PostedScore[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load scores.");
        setScores(data.scores ?? []);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "Couldn't load scores.");
      });
    return () => controller.abort();
  }, [user.publicKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(score: PostedScore) {
    const link = challengeLink(window.location.origin, {
      score: score.score,
      near: score.near,
      username: user.username,
      publicKey: user.publicKey,
    });
    await navigator.clipboard.writeText(link);
    setCopied(score.postHashHex);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="scores-title">
      <button className="backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="pill">DeSo</div>
            <h2 id="scores-title">Posted scores</h2>
          </div>
          <button className="text-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="subtitle left">Each post is a challenge. Copy the link and send it to someone who thinks they can last longer.</p>
        {status === "loading" && <p className="hint">Loading your posts…</p>}
        {status === "error" && <p className="hint warn">{error}</p>}
        {status === "ready" && scores.length === 0 && (
          <p className="hint">No posted scores yet. Finish a run and post it to DeSo.</p>
        )}
        {status === "ready" && scores.length > 0 && (
          <ul className="score-list">
            {scores.map((score) => (
              <li key={score.postHashHex}>
                <div>
                  <strong>{formatSeconds(score.score)}s</strong>
                  <span>
                    {score.near} near misses
                    {score.createdAt ? ` · ${formatWhen(score.createdAt)}` : ""}
                    {score.challengedUsernames?.length
                      ? ` · challenged ${score.challengedUsernames.map((name) => `@${name}`).join(", ")}`
                      : ""}
                  </span>
                </div>
                <div className="actions tight">
                  <button className="secondary slim" type="button" onClick={() => void copy(score)}>
                    {copied === score.postHashHex ? "Copied" : "Copy link"}
                  </button>
                  <a href={desoPostUrl(score.postHashHex)} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
