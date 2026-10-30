"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GameCanvas, type GameHandle } from "@/components/GameCanvas";
import { HighScoresDialog } from "@/components/HighScoresDialog";
import { ScoresDialog } from "@/components/ScoresDialog";
import { ShareSheet, type PostNotice } from "@/components/ShareSheet";
import { challengeFromParams, decodeChallenge } from "@/lib/challenge";
import {
  desoErrorMessage,
  fetchDesoProfile,
  loginWithDeSo,
  logoutDeSo,
  watchDeSo,
} from "@/lib/deso-client";
import { beatScore, formatSeconds, profilePictureUrl, shortKey } from "@/lib/format";
import {
  clearPendingShare,
  getBestServerSnapshot,
  getBestSnapshot,
  getPendingServerSnapshot,
  getPendingSnapshot,
  subscribeBest,
  subscribePending,
  writeLastRun,
} from "@/lib/storage";
import { currentPlayerId, submitHighScore } from "@/lib/submit-high-score";
import type { Challenge, DesoUser, RunResult, XStatus } from "@/lib/types";

type Phase = "intro" | "playing" | "over";

const EMPTY_X: XStatus = { configured: false, connected: false };

async function loadXStatus(): Promise<XStatus> {
  try {
    const response = await fetch("/api/x/status");
    const data = (await response.json()) as Partial<XStatus>;
    return {
      configured: Boolean(data.configured),
      connected: Boolean(data.connected),
      username: typeof data.username === "string" ? data.username : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
    };
  } catch {
    return EMPTY_X;
  }
}

export function KeepAliveApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challenge = decodeChallenge(searchParams.get("c")) ?? challengeFromParams(searchParams);
  const gameRef = useRef<GameHandle>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const nearRef = useRef<HTMLSpanElement>(null);
  const timeStatRef = useRef<HTMLDivElement>(null);
  const allowHotkeysRef = useRef(true);
  const accountRef = useRef<HTMLDivElement>(null);
  const best = useSyncExternalStore(subscribeBest, getBestSnapshot, getBestServerSnapshot);
  const pendingRun = useSyncExternalStore(subscribePending, getPendingSnapshot, getPendingServerSnapshot);
  const xFlag = searchParams.get("x");
  const xReason = searchParams.get("reason");
  const returnTo = searchParams.toString() ? `/?${searchParams.toString()}` : "/";
  const connectHref = `/api/x/connect?next=${encodeURIComponent(returnTo)}`;

  const [phase, setPhase] = useState<Phase>("intro");
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [share, setShare] = useState<RunResult | null>(null);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [highScoresOpen, setHighScoresOpen] = useState(false);
  const [user, setUser] = useState<DesoUser | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [xStatus, setXStatus] = useState<XStatus>(EMPTY_X);
  const [notice, setNotice] = useState<PostNotice | null>(null);
  const [flagSeen, setFlagSeen] = useState<string | null>(null);
  const [didRestore, setDidRestore] = useState(false);

  const flagKey = xFlag ? `${xFlag}:${xReason ?? ""}` : null;
  if (flagKey && flagSeen !== flagKey) {
    setFlagSeen(flagKey);
    setNotice(
      xFlag === "connected"
        ? { text: "X account connected.", ok: true }
        : xFlag === "error"
          ? { text: xErrorMessage(xReason), ok: false }
          : null
    );
  }
  if (pendingRun && !didRestore) {
    setDidRestore(true);
    setLastResult(pendingRun);
    setShare(pendingRun);
    setPhase("over");
  }

  useEffect(() => {
    allowHotkeysRef.current = !share && !scoresOpen && !highScoresOpen;
  }, [share, scoresOpen, highScoresOpen]);

  useEffect(() => {
    if (best.seconds <= 0) return;
    const timer = window.setTimeout(() => {
      void submitHighScore({
        seconds: best.seconds,
        near: best.near,
        username: user?.username,
        publicKey: user?.publicKey,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [best.near, best.seconds, user?.publicKey, user?.username]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadXStatus().then(setXStatus);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    void watchDeSo((next) => {
      if (cancelled) return;
      setUser((current) => {
        if (!next) return null;
        const username = next.username || (current?.publicKey === next.publicKey ? current.username : undefined);
        return { publicKey: next.publicKey, username };
      });
      if (next && !next.username) {
        void fetchDesoProfile(next.publicKey).then((profile) => {
          if (!profile.username || cancelled) return;
          setUser((current) =>
            current?.publicKey === profile.publicKey ? { ...current, username: profile.username } : current
          );
        });
      }
    }).then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && accountRef.current?.contains(target)) return;
      setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (didRestore) clearPendingShare();
  }, [didRestore]);

  useEffect(() => {
    if (!xFlag) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("x");
    params.delete("reason");
    router.replace(params.size ? `/?${params.toString()}` : "/", { scroll: false });
  }, [router, searchParams, xFlag]);

  function onHud(seconds: number, near: number) {
    if (timeRef.current) timeRef.current.textContent = formatSeconds(seconds);
    if (nearRef.current) nearRef.current.textContent = String(near);
    timeStatRef.current?.classList.toggle("ahead", Boolean(challenge && beatScore(seconds, challenge.score)));
  }

  function onPhase(next: "playing" | "over") {
    setPhase(next);
    if (next === "playing") {
      setShare(null);
      setScoresOpen(false);
      setHighScoresOpen(false);
      setAccountOpen(false);
    }
  }

  function onEnd(result: RunResult) {
    setLastResult(result);
    writeLastRun(result);
    if (timeRef.current) timeRef.current.textContent = formatSeconds(result.seconds);
    if (nearRef.current) nearRef.current.textContent = String(result.nearMisses);
  }

  async function login() {
    setAuthBusy(true);
    try {
      const next = await loginWithDeSo();
      if (next) {
        setUser((current) => ({
          publicKey: next.publicKey,
          username: next.username || (current?.publicKey === next.publicKey ? current.username : undefined),
        }));
      }
    } catch (error) {
      setNotice({ text: desoErrorMessage(error), ok: false });
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    setAccountOpen(false);
    setAuthBusy(true);
    try {
      const done = await logoutDeSo();
      if (done) setUser(null);
    } catch (error) {
      setNotice({ text: desoErrorMessage(error), ok: false });
    } finally {
      setAuthBusy(false);
    }
  }

  const beat = Boolean(lastResult && challenge && beatScore(lastResult.seconds, challenge.score));
  const status =
    phase === "playing" ? "STAY SHARP" : phase === "over" ? "RUN COMPLETE" : "READY WHEN YOU ARE";
  const challenger = challenge?.username ? `@${challenge.username}` : "A friend";

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          KEEP <span>IT</span> ALIVE
        </div>
        <div className="auth">
          <button className="secondary slim" type="button" onClick={() => setHighScoresOpen(true)}>
            High scores
          </button>
          {user && (
            <button className="secondary slim" type="button" onClick={() => setScoresOpen(true)}>
              Scores
            </button>
          )}
          {xStatus.configured &&
            (xStatus.connected ? (
              <span className="pill">X · @{xStatus.username}</span>
            ) : (
              <a className="secondary slim" href={connectHref}>
                Connect X
              </a>
            ))}
          {user ? (
            <div className="account" ref={accountRef}>
              <button
                className="who"
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                onClick={() => setAccountOpen((open) => !open)}
              >
                {/* DeSo picture URLs redirect through the node, so they stay a plain image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={profilePictureUrl(user.publicKey, user.username)} alt="" width={28} height={28} />
                <span>{user.username ? `@${user.username}` : shortKey(user.publicKey)}</span>
                <span className={accountOpen ? "caret open" : "caret"} aria-hidden="true" />
              </button>
              {accountOpen && (
                <div className="account-menu" id="account-menu" role="menu">
                  <button
                    className="account-item"
                    type="button"
                    role="menuitem"
                    onClick={() => void logout()}
                    disabled={authBusy}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="primary slim" type="button" onClick={() => void login()} disabled={authBusy}>
              {authBusy ? "Opening DeSo…" : "Log in with DeSo"}
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className={notice.ok ? "notice" : "notice warn"} role="status">
          {notice.text}
          {notice.href && (
            <>
              {" "}
              <a href={notice.href} target="_blank" rel="noopener noreferrer">
                {notice.hrefLabel || "View post"}
              </a>
            </>
          )}
        </div>
      )}

      <section className="stats" aria-label="Game stats">
        <div className="stat" ref={timeStatRef}>
          <div className="label">Time alive</div>
          <div className="value">
            <span ref={timeRef}>0.0</span>
            <small>s</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Best</div>
          <div className="value">
            <span>{formatSeconds(best.seconds)}</span>
            <small>s</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Near misses</div>
          <div className="value">
            <span ref={nearRef}>0</span>
          </div>
        </div>
        {challenge && (
          <div className="stat">
            <div className="label">To beat</div>
            <div className="value">
              <span>{formatSeconds(challenge.score)}</span>
              <small>s</small>
            </div>
          </div>
        )}
      </section>

      {challenge && phase !== "over" && (
        <div className="challenge-banner">
          {challenger} lasted {formatSeconds(challenge.score)}s
          {challenge.near ? ` · ${challenge.near} near misses` : ""}. Beat it.
        </div>
      )}

      <section className="arena" aria-label="Game arena">
        <GameCanvas
          ref={gameRef}
          onHud={onHud}
          onPhase={onPhase}
          onEnd={onEnd}
          allowHotkeysRef={allowHotkeysRef}
        />
        {phase === "intro" && (
          <div className="overlay">
            <div className="card">
              <div className="orb-icon" />
              <h1>
                KEEP IT <em>ALIVE.</em>
              </h1>
              <p className="subtitle">
                {challenge ? (
                  <>
                    {challenger} lasted {formatSeconds(challenge.score)} seconds.
                    <br />
                    Can you go longer?
                  </>
                ) : (
                  <>
                    One orb. Endless danger.
                    <br />
                    How long can you survive?
                  </>
                )}
              </p>
              <div className="actions">
                <button className="primary" type="button" onClick={() => gameRef.current?.start()}>
                  {challenge ? `Beat ${formatSeconds(challenge.score)}s` : "Start run"} ↗
                </button>
                {best.seconds > 0 && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      setShare({
                        seconds: best.seconds,
                        nearMisses: best.near,
                        best: best.seconds,
                        isBest: true,
                      })
                    }
                  >
                    Challenge with best
                  </button>
                )}
              </div>
              <div className="hint">DRAG TO MOVE · ON A PHONE THE ORB FLOATS ABOVE YOUR FINGER</div>
            </div>
          </div>
        )}
        {phase === "over" && lastResult && (
          <div className="overlay">
            <div className="card">
              <div className="pill">{beat ? "CHALLENGE BEATEN" : lastResult.isBest ? "NEW PERSONAL BEST" : "RUN ENDED"}</div>
              <h1>{headline(lastResult, challenge, beat)}</h1>
              <div className="result-score">
                {formatSeconds(lastResult.seconds)}
                <small> sec</small>
              </div>
              <p className="subtitle">{resultCopy(lastResult, challenge, beat)}</p>
              <div className="result-row">
                <div>
                  <span>Near misses</span>
                  <b>{lastResult.nearMisses}</b>
                </div>
                <div>
                  <span>Personal best</span>
                  <b>{formatSeconds(lastResult.best)}s</b>
                </div>
              </div>
              <div className="actions">
                <button className="primary" type="button" onClick={() => gameRef.current?.start()}>
                  Try again ↗
                </button>
                <button className="secondary" type="button" onClick={() => setShare(lastResult)}>
                  Post score
                </button>
              </div>
              <div className="hint">No lives. No levels. Just you.</div>
            </div>
          </div>
        )}
      </section>

      <footer className="footer">
        <div>
          <span className="dot" />
          <span>{status}</span>
        </div>
        <div className="controls">
          <span>FREE TO PLAY</span>
          <span className="sep">·</span>
          <span>POST YOUR SCORE</span>
        </div>
      </footer>

      {share && (
        <ShareSheet
          result={share}
          user={user}
          xStatus={xStatus}
          incoming={challenge}
          connectHref={connectHref}
          onClose={() => setShare(null)}
          onLogin={() => void login()}
          onXChange={() => void loadXStatus().then(setXStatus)}
          onPosted={setNotice}
        />
      )}
      {scoresOpen && user && <ScoresDialog user={user} onClose={() => setScoresOpen(false)} />}
      {highScoresOpen && (
        <HighScoresDialog
          youIds={[
            currentPlayerId() ? `guest:${currentPlayerId()}` : "",
            user ? `deso:${user.publicKey}` : "",
          ].filter(Boolean)}
          onClose={() => setHighScoresOpen(false)}
        />
      )}
    </main>
  );
}

function headline(result: RunResult, challenge: Challenge | null, beat: boolean): string {
  if (beat && challenge) return "You took the lead.";
  if (result.isBest) return "New best.";
  return "So close.";
}

function resultCopy(result: RunResult, challenge: Challenge | null, beat: boolean): string {
  if (beat && challenge) {
    const who = challenge.username ? `@${challenge.username}` : "That mark";
    return `${who} held ${formatSeconds(challenge.score)}s. You went longer.`;
  }
  if (challenge) {
    const who = challenge.username ? `@${challenge.username}` : "The challenge";
    return `${who} is still ahead at ${formatSeconds(challenge.score)}s.`;
  }
  if (result.seconds < 10) return "Warm-up over. You can go longer.";
  if (result.seconds < 25) return "Not bad. The hazards are learning.";
  return "That was a run. Can you top it?";
}

function xErrorMessage(reason: string | null): string {
  if (reason === "config") return "X isn't configured yet. Add the API credentials and try again.";
  if (reason === "denied") return "X connection was cancelled.";
  if (reason === "state") return "X login expired. Connect again.";
  return "Couldn't connect X. Check the callback URL and credentials.";
}
