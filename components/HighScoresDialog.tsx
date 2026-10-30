"use client";

import { useEffect, useState } from "react";
import { formatSeconds, formatWhen } from "@/lib/format";

type BoardScore = {
  id: string;
  name: string;
  seconds: number;
  near: number;
  updatedAt: string;
};

export function HighScoresDialog({
  youIds,
  onClose,
}: {
  youIds: string[];
  onClose: () => void;
}) {
  const [scores, setScores] = useState<BoardScore[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/high-scores", { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { scores?: BoardScore[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load high scores.");
        setScores(data.scores ?? []);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "Couldn't load high scores.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="high-scores-title">
      <button className="backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="pill">Server</div>
            <h2 id="high-scores-title">High scores</h2>
          </div>
          <button className="text-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="subtitle left">Best times, highest first. A new personal best is saved on this server.</p>
        {status === "loading" && <p className="hint">Loading high scores…</p>}
        {status === "error" && <p className="hint warn">{error}</p>}
        {status === "ready" && scores.length === 0 && (
          <p className="hint">No high scores yet. Finish a run and yours will land here.</p>
        )}
        {status === "ready" && scores.length > 0 && (
          <ol className="score-list board">
            {scores.map((score, index) => (
              <li key={score.id} className={youIds.includes(score.id) ? "you" : undefined}>
                <div className="who-score">
                  <b className="rank">{index + 1}</b>
                  <div>
                    <strong>{formatSeconds(score.seconds)}s</strong>
                    <span>
                      {score.name}
                      {score.near ? ` · ${score.near} near misses` : ""}
                      {score.updatedAt ? ` · ${formatWhen(score.updatedAt)}` : ""}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
