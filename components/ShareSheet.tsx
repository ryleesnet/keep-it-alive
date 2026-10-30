"use client";

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { APP_TAG, desoPostUrl } from "@/lib/constants";
import { challengeLink } from "@/lib/challenge";
import { desoErrorMessage, publishScore } from "@/lib/deso-client";
import { USERNAME } from "@/lib/deso-node";
import { beatScore, formatSeconds, profilePictureUrl } from "@/lib/format";
import { buildPosts } from "@/lib/post-copy";
import { markPendingShare, writeLastRun } from "@/lib/storage";
import type { Challenge, DesoUser, RunResult, XStatus } from "@/lib/types";

const MAX_FRIENDS = 8;

type Friend = { username: string; publicKey: string };

type Suggestion = { username: string; publicKey: string; description?: string };

export type PostNotice = {
  text: string;
  ok: boolean;
  href?: string;
  hrefLabel?: string;
};

export function ShareSheet({
  result,
  user,
  xStatus,
  incoming,
  connectHref,
  onClose,
  onLogin,
  onXChange,
  onPosted,
}: {
  result: RunResult;
  user: DesoUser | null;
  xStatus: XStatus;
  incoming: Challenge | null;
  connectHref: string;
  onClose: () => void;
  onLogin: () => void;
  onXChange: () => void;
  onPosted: (notice: PostNotice) => void;
}) {
  const beatIncoming = Boolean(incoming && beatScore(result.seconds, incoming.score));
  const [query, setQuery] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchResult, setSearchResult] = useState<{ query: string; profiles: Suggestion[]; error: string } | null>(
    null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [useDeso, setUseDeso] = useState(true);
  const [useX, setUseX] = useState(true);
  const [desoOverride, setDesoOverride] = useState<string | null>(null);
  const [xOverride, setXOverride] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [copied, setCopied] = useState(false);

  const friendName = query.trim().replace(/^@/, "");
  const friendInvalid = friendName.length > 0 && !USERNAME.test(friendName);
  const atLimit = friends.length >= MAX_FRIENDS;
  const activeSearch = searchResult?.query === friendName ? searchResult : null;
  const suggestions = (activeSearch?.profiles ?? []).filter(
    (profile) =>
      profile.publicKey !== user?.publicKey && !friends.some((friend) => friend.publicKey === profile.publicKey)
  );
  const highlight = suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);
  const showMenu = menuOpen && friendName.length > 0 && !friendInvalid && !atLimit;

  useEffect(() => {
    const name = beatIncoming ? incoming?.username?.replace(/^@/, "") || "" : "";
    if (!USERNAME.test(name)) return;
    const controller = new AbortController();
    void fetch(`/api/deso/profile?username=${encodeURIComponent(name)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { username?: string; publicKey?: string };
        if (!response.ok || !data.publicKey || !data.username) return;
        const username = data.username;
        const publicKey = data.publicKey;
        setFriends((current) => {
          if (current.some((friend) => friend.publicKey === publicKey) || current.length >= MAX_FRIENDS) return current;
          return [{ username, publicKey }, ...current];
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [beatIncoming, incoming?.username]);

  useEffect(() => {
    if (!friendName || friendInvalid || atLimit) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/deso/search?q=${encodeURIComponent(friendName)}`, { signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json()) as { profiles?: Suggestion[]; error?: string };
          if (!response.ok) throw new Error(data.error || "Couldn't search DeSo.");
          setSearchResult({ query: friendName, profiles: data.profiles ?? [], error: "" });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSearchResult({
            query: friendName,
            profiles: [],
            error: error instanceof Error ? error.message : "Couldn't search DeSo.",
          });
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [atLimit, friendInvalid, friendName]);

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
  const mentions = friends.map((friend) => friend.username);
  const generated = buildPosts({
    seconds: result.seconds,
    near: result.nearMisses,
    link: link || "https://keep-it-alive.local/?c=pending",
    mentions,
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
    if (!canPostDeso && !canPostX) {
      if (!user) onLogin();
      return;
    }
    setPosting(true);
    const notes: string[] = [];
    let ok = true;
    let href: string | undefined;
    let hrefLabel: string | undefined;
    try {
      if (canPostDeso && user) {
        try {
          const extra: Record<string, string> = {
            App: APP_TAG,
            Version: "1",
            ScoreSeconds: formatSeconds(result.seconds),
            NearMisses: String(result.nearMisses),
          };
          if (friends.length) {
            extra.ChallengedUsername = friends[0].username;
            extra.ChallengedPublicKey = friends[0].publicKey;
            extra.ChallengedUsernames = friends.map((friend) => friend.username).join(",");
            extra.ChallengedPublicKeys = friends.map((friend) => friend.publicKey).join(",");
          }
          const postHashHex = await publishScore(user.publicKey, desoText, extra);
          notes.push("Posted to DeSo.");
          href = desoPostUrl(postHashHex);
          hrefLabel = "View post";
        } catch (error) {
          ok = false;
          notes.push(desoErrorMessage(error));
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
          notes.push("Posted to X.");
          if (!href && data.url) {
            href = data.url;
            hrefLabel = "View post";
          }
        } catch (error) {
          ok = false;
          notes.push(error instanceof Error ? error.message : "Couldn't post to X.");
        }
      }
    } finally {
      setPosting(false);
    }
    onPosted({ text: notes.join(" ") || "Couldn't post that score.", ok, href, hrefLabel });
    onClose();
  }

  function addFriend(profile: Suggestion) {
    setFriends((current) => {
      if (current.length >= MAX_FRIENDS || current.some((friend) => friend.publicKey === profile.publicKey)) {
        return current;
      }
      return [...current, profile];
    });
    setQuery("");
    setMenuOpen(false);
    setActiveIndex(0);
  }

  function onQueryKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showMenu) {
      event.stopPropagation();
      setMenuOpen(false);
      return;
    }
    if (!showMenu || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = suggestions[highlight];
      if (pick) addFriend(pick);
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

        <div className="field">
          <span>Challenge DeSo friends</span>
          {friends.length > 0 && (
            <div className="chips">
              {friends.map((friend) => (
                <span className="chip" key={friend.publicKey}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profilePictureUrl(friend.publicKey, friend.username)} alt="" width={22} height={22} />
                  <span>@{friend.username}</span>
                  <button
                    type="button"
                    aria-label={`Remove @${friend.username}`}
                    onClick={() => setFriends((current) => current.filter((item) => item.publicKey !== friend.publicKey))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="suggest">
            <input
              value={query}
              role="combobox"
              aria-expanded={showMenu}
              aria-controls="friend-results"
              aria-autocomplete="list"
              onChange={(event) => {
                setQuery(event.target.value);
                setMenuOpen(true);
                setActiveIndex(0);
              }}
              onFocus={() => setMenuOpen(true)}
              onKeyDown={onQueryKeyDown}
              placeholder={atLimit ? "8 friends is the limit" : "Search DeSo usernames"}
              disabled={atLimit}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            {showMenu && (
              <ul className="suggest-list" id="friend-results" role="listbox">
                {!activeSearch && <li className="suggest-status">Searching DeSo…</li>}
                {activeSearch?.error && <li className="suggest-status">{activeSearch.error}</li>}
                {activeSearch && !activeSearch.error && suggestions.length === 0 && (
                  <li className="suggest-status">
                    {activeSearch.profiles.length > 0 &&
                    activeSearch.profiles.every((profile) => profile.publicKey === user?.publicKey)
                      ? "That profile is you."
                      : activeSearch.profiles.length > 0
                        ? "Those profiles are already added."
                        : "No matching profiles."}
                  </li>
                )}
                {suggestions.map((profile, index) => (
                  <li key={profile.publicKey}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => addFriend(profile)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={profilePictureUrl(profile.publicKey, profile.username)}
                        alt=""
                        width={32}
                        height={32}
                      />
                      <span className="suggest-copy">
                        <strong>@{profile.username}</strong>
                        {profile.description && <small>{profile.description}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {friendInvalid && <p className="hint warn">Use letters, numbers, or underscores.</p>}

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
          ) : null}
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
      </div>
    </div>
  );
}
