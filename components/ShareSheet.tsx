"use client";

import { useEffect, useState } from "react";
import { APP_TAG, desoPostUrl } from "@/lib/constants";
import { challengeLink } from "@/lib/challenge";
import { desoErrorMessage, publishScore } from "@/lib/deso-client";
import { beatScore, formatSeconds, profilePictureUrl } from "@/lib/format";
import { buildPosts } from "@/lib/post-copy";
import { markPendingShare, writeLastRun } from "@/lib/storage";
import type { Challenge, DesoUser, RunResult, XStatus } from "@/lib/types";

type Friend = { username?: string; publicKey: string };

type DestinationResult = { ok: boolean; url?: string; error?: string };

export function ShareSheet({
  result,
  user,
  xStatus,
  incoming,
  connectHref,
  onClose,
  onLogin,
  onXChange,
}: {
  result: RunResult;
  user: DesoUser | null;
  xStatus: XStatus;
  incoming: Challenge | null;
  connectHref: string;
  onClose: () => void;
  onLogin: () => void;
  onXChange: () => void;
}) {
  const beatIncoming = Boolean(incoming && beatScore(result.seconds, incoming.score));
  const [query, setQuery] = useState(beatIncoming && incoming?.username ? incoming.username : "");
  const [lookupResult, setLookupResult] = useState<{ query: string; friend: Friend | null; error: string } | null>(
    null
  );
  const [useDeso, setUseDeso] = useState(true);
  const [useX, setUseX] = useState(true);
  const [desoOverride, setDesoOverride] = useState<string | null>(null);
  const [xOverride, setXOverride] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [desoResult, setDesoResult] = useState<DestinationResult | null>(null);
  const [xResult, setXResult] = useState<DestinationResult | null>(null);

  const friendName = query.trim().replace(/^@/, "");
  const friendInvalid = friendName.length > 0 && !/^[A-Za-z0-9_]{1,25}$/.test(friendName);
  const activeLookup = lookupResult?.query === friendName ? lookupResult : null;

  useEffect(() => {
    if (!friendName || friendInvalid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/deso/profile?username=${encodeURIComponent(friendName)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string; username?: string; publicKey?: string };
          if (!response.ok || !data.publicKey) throw new Error(data.error || "No DeSo profile by that name.");
          setLookupResult({
            query: friendName,
            friend: { username: data.username, publicKey: data.publicKey },
            error: "",
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLookupResult({
            query: friendName,
            friend: null,
            error: error instanceof Error ? error.message : "No DeSo profile by that name.",
          });
        });
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [friendInvalid, friendName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const link =
    typeof window === "undefined"
      ? ""
      : challengeLink(window.location.origin, {
          score: result.seconds,
          near: result.nearMisses,
          username: user?.username,
          publicKey: user?.publicKey,
        });
  const friend = activeLookup?.friend ?? null;
  const mention = friend?.username;
  const generated = buildPosts({
    seconds: result.seconds,
    near: result.nearMisses,
    link: link || "https://keep-it-alive.local/?c=pending",
    mention,
    beaten: beatIncoming && incoming ? { username: incoming.username, score: incoming.score } : undefined,
  });
  const desoText = desoOverride ?? generated.deso;
  const xText = xOverride ?? generated.x;
  const canPostDeso = useDeso && Boolean(user);
  const canPostX = useX && xStatus.connected;
  const xTooLong = xText.length > 280;

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  function rememberShare() {
    writeLastRun(result);
    markPendingShare();
  }

  async function disconnectX() {
    await fetch("/api/x/disconnect", { method: "POST" });
    setUseX(false);
    onXChange();
  }

  async function post() {
    if (posting) return;
    setDesoResult(null);
    setXResult(null);
    if (!canPostDeso && !canPostX) {
      if (!user) onLogin();
      return;
    }
    setPosting(true);
    try {
      if (canPostDeso && user) {
        try {
          const extra: Record<string, string> = {
            App: APP_TAG,
            Version: "1",
            ScoreSeconds: formatSeconds(result.seconds),
            NearMisses: String(result.nearMisses),
          };
          if (friend?.username) extra.ChallengedUsername = friend.username;
          if (friend?.publicKey) extra.ChallengedPublicKey = friend.publicKey;
          const postHashHex = await publishScore(user.publicKey, desoText, extra);
          setDesoResult({ ok: true, url: desoPostUrl(postHashHex) });
        } catch (error) {
          setDesoResult({ ok: false, error: desoErrorMessage(error) });
        }
      }
      if (canPostX) {
        try {
          const response = await fetch("/api/x/post", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: xText }),
          });
          const data = (await response.json()) as { url?: string; error?: string };
          if (!response.ok) throw new Error(data.error || "X rejected the post.");
          setXResult({ ok: true, url: data.url });
        } catch (error) {
          setXResult({ ok: false, error: error instanceof Error ? error.message : "Couldn't post to X." });
        }
      }
    } finally {
      setPosting(false);
    }
  }

  const who = incoming?.username ? `@${incoming.username}` : "their mark";

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button className="backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="pill">Challenge</div>
            <h2 id="share-title">Post {formatSeconds(result.seconds)}s</h2>
          </div>
          <button className="text-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="subtitle left">
          {beatIncoming
            ? `You beat ${who} at ${formatSeconds(incoming?.score || 0)}s. Send the link so they can answer.`
            : incoming
              ? `${who} is still ahead at ${formatSeconds(incoming.score)}s. You can still post this run.`
              : "Friends who open the link have to beat this time."}
        </p>

        <label className="field">
          <span>Challenge a DeSo friend</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setDesoOverride(null);
            }}
            placeholder="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {friendInvalid && <p className="hint warn">Use letters, numbers, or underscores.</p>}
        {friendName && !friendInvalid && !activeLookup && <p className="hint">Looking up that profile…</p>}
        {activeLookup?.error && <p className="hint warn">{activeLookup.error}</p>}
        {friend && (
          <div className="friend">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profilePictureUrl(friend.publicKey, friend.username)} alt="" width={28} height={28} />
            <span>{friend.username ? `@${friend.username}` : "DeSo profile"} will be mentioned on DeSo.</span>
          </div>
        )}

        <div className="destinations">
          <label className={`check ${user ? "" : "off"}`}>
            <input
              type="checkbox"
              checked={canPostDeso}
              disabled={!user}
              onChange={(event) => setUseDeso(event.target.checked)}
            />
            <span>Post to DeSo{user?.username ? ` as @${user.username}` : ""}</span>
          </label>
          {!user && (
            <button className="secondary slim" type="button" onClick={onLogin}>
              Log in with DeSo
            </button>
          )}

          {xStatus.configured ? (
            <>
              <label className={`check ${xStatus.connected ? "" : "off"}`}>
                <input
                  type="checkbox"
                  checked={canPostX}
                  disabled={!xStatus.connected}
                  onChange={(event) => setUseX(event.target.checked)}
                />
                <span>Post to X{xStatus.username ? ` as @${xStatus.username}` : ""}</span>
              </label>
              {xStatus.connected ? (
                <button className="text-btn" type="button" onClick={() => void disconnectX()}>
                  Disconnect X
                </button>
              ) : (
                <a className="secondary slim" href={connectHref} onClick={rememberShare}>
                  Connect X
                </a>
              )}
            </>
          ) : (
            <p className="hint">
              X posting needs an approved X app. Add the credentials in <code>.env.local</code>.
            </p>
          )}
        </div>

        {canPostDeso && (
          <label className="field">
            <span>DeSo post</span>
            <textarea
              value={desoText}
              maxLength={2000}
              onChange={(event) => setDesoOverride(event.target.value)}
            />
          </label>
        )}
        {canPostX && (
          <label className="field">
            <span>X post · {xText.length}/280</span>
            <textarea value={xText} onChange={(event) => setXOverride(event.target.value)} />
            <span className="hint">X gets the score and link. DeSo @mentions stay on DeSo.</span>
          </label>
        )}
        {(desoOverride !== null || xOverride !== null) && (
          <button
            className="text-btn"
            type="button"
            onClick={() => {
              setDesoOverride(null);
              setXOverride(null);
            }}
          >
            Reset text
          </button>
        )}

        <div className="actions">
          <button className="primary" type="button" onClick={() => void post()} disabled={posting || (canPostX && xTooLong) || (!canPostDeso && !canPostX && Boolean(user))}>
            {posting ? "Posting…" : canPostDeso || canPostX ? "Post score" : "Log in to post"}
          </button>
          <button className="secondary" type="button" onClick={() => void copyLink()}>
            {copied ? "Link copied" : "Copy challenge link"}
          </button>
        </div>
        {canPostX && xTooLong && <p className="hint warn">Shorten the X post to 280 characters.</p>}
        {desoResult && (
          <p className={desoResult.ok ? "hint good" : "hint warn"}>
            {desoResult.ok ? (
              <a href={desoResult.url} target="_blank" rel="noopener noreferrer">
                View on DeSo
              </a>
            ) : (
              desoResult.error
            )}
          </p>
        )}
        {xResult && (
          <p className={xResult.ok ? "hint good" : "hint warn"}>
            {xResult.ok ? (
              <a href={xResult.url} target="_blank" rel="noopener noreferrer">
                View on X
              </a>
            ) : (
              xResult.error
            )}
          </p>
        )}
      </div>
    </div>
  );
}
