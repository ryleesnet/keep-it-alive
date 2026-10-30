"use client";

import { useEffect, useRef, useState } from "react";
import { commentOnPost, desoErrorMessage, publishSocialPost, sendPostDiamonds, setPostLike } from "@/lib/deso-client";
import { formatSeconds, formatWhen, profilePictureUrl, shortKey } from "@/lib/format";
import type { DesoUser, SocialComment, SocialPost } from "@/lib/types";

const DIAMONDS = [
  { level: 1, nanos: 50_000 },
  { level: 2, nanos: 500_000 },
  { level: 3, nanos: 5_000_000 },
  { level: 4, nanos: 50_000_000 },
  { level: 5, nanos: 500_000_000 },
  { level: 6, nanos: 5_000_000_000 },
] as const;

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type DraftPhoto = { id: string; file: File; url: string };

export function SocialDialog({
  user,
  onClose,
  onLogin,
}: {
  user: DesoUser | null;
  onClose: () => void;
  onLogin: () => void;
}) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [thread, setThread] = useState<string | null>(null);
  const [chatResult, setChatResult] = useState<{ post: string; comments: SocialComment[]; error: string } | null>(
    null
  );
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const photosRef = useRef<DraftPhoto[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const reader = user?.publicKey ? `?reader=${encodeURIComponent(user.publicKey)}` : "";
    void fetch(`/api/deso/feed${reader}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { posts?: SocialPost[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load the feed.");
        setPosts(data.posts ?? []);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "Couldn't load the feed.");
      });
    return () => controller.abort();
  }, [user?.publicKey]);

  useEffect(() => {
    if (!thread) return;
    const controller = new AbortController();
    void fetch(`/api/deso/comments?post=${encodeURIComponent(thread)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { comments?: SocialComment[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load that chat.");
        setChatResult({ post: thread, comments: data.comments ?? [], error: "" });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setChatResult({
          post: thread,
          comments: [],
          error: reason instanceof Error ? reason.message : "Couldn't load that chat.",
        });
      });
    return () => controller.abort();
  }, [thread]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = posts.find((post) => post.postHashHex === thread) ?? null;
  const chat = chatResult?.post === thread ? chatResult : null;

  function requireUser(): DesoUser | null {
    if (user) return user;
    onLogin();
    return null;
  }

  async function toggleLike(post: SocialPost) {
    const actor = requireUser();
    if (!actor || busy) return;
    const liked = post.likedByReader;
    setActionError("");
    setBusy(`${post.postHashHex}:like`);
    patchPost(post.postHashHex, {
      likedByReader: !liked,
      likeCount: Math.max(0, post.likeCount + (liked ? -1 : 1)),
    });
    try {
      await setPostLike(actor.publicKey, post.postHashHex, liked);
    } catch (reason) {
      patchPost(post.postHashHex, { likedByReader: liked, likeCount: post.likeCount });
      setActionError(desoErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function giveDiamonds(post: SocialPost, level: number) {
    const actor = requireUser();
    if (!actor || busy || actor.publicKey === post.publicKey || level <= post.diamondLevel) return;
    setActionError("");
    setBusy(`${post.postHashHex}:diamond`);
    try {
      await sendPostDiamonds(actor.publicKey, post.publicKey, post.postHashHex, level);
      patchPost(post.postHashHex, {
        diamondLevel: level,
        diamondCount: post.diamondLevel > 0 ? post.diamondCount : post.diamondCount + 1,
      });
      setPicker(null);
    } catch (reason) {
      setActionError(desoErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function sendChat(post: SocialPost) {
    const actor = requireUser();
    const body = draft.trim();
    if (!actor || busy || !body) return;
    setActionError("");
    setBusy(`${post.postHashHex}:chat`);
    try {
      const postHashHex = await commentOnPost(actor.publicKey, post.postHashHex, body);
      setChatResult((current) => ({
        post: post.postHashHex,
        error: "",
        comments: [
          ...(current?.post === post.postHashHex ? current.comments : []),
          {
            postHashHex,
            publicKey: actor.publicKey,
            username: actor.username,
            body,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      patchPost(post.postHashHex, { commentCount: post.commentCount + 1 });
      setDraft("");
    } catch (reason) {
      setActionError(desoErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  function addPhotos(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next: DraftPhoto[] = [];
    let rejected = "";
    for (const file of Array.from(list)) {
      if (photos.length + next.length >= MAX_PHOTOS) {
        rejected = "You can add up to 4 photos.";
        break;
      }
      if (!PHOTO_TYPES.has(file.type)) {
        rejected = "Use a JPEG, PNG, GIF, or WebP photo.";
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        rejected = "Each photo needs to be under 8 MB.";
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
    if (next.length) setPhotos((current) => [...current, ...next].slice(0, MAX_PHOTOS));
    setActionError(rejected);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function publishNote() {
    const actor = requireUser();
    const body = note.trim();
    if (!actor || busy || (!body && photos.length === 0)) return;
    setActionError("");
    setBusy("compose");
    try {
      const published = await publishSocialPost(
        actor.publicKey,
        body,
        photos.map((photo) => photo.file)
      );
      setPosts((current) => [
        {
          postHashHex: published.postHashHex,
          publicKey: actor.publicKey,
          username: actor.username,
          score: null,
          near: 0,
          body: published.body,
          images: published.imageUrls,
          createdAt: new Date().toISOString(),
          likeCount: 0,
          diamondCount: 0,
          commentCount: 0,
          likedByReader: false,
          diamondLevel: 0,
        },
        ...current.filter((post) => post.postHashHex !== published.postHashHex),
      ]);
      setNote("");
      setPhotos((current) => {
        for (const photo of current) URL.revokeObjectURL(photo.url);
        return [];
      });
      setStatus("ready");
    } catch (reason) {
      setActionError(desoErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  function patchPost(postHashHex: string, patch: Partial<SocialPost>) {
    setPosts((current) => current.map((post) => (post.postHashHex === postHashHex ? { ...post, ...patch } : post)));
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="social-title">
      <button className="backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className="modal-card wide">
        <div className="modal-head">
          <div>
            <div className="pill">DeSo</div>
            <h2 id="social-title">{active ? "Chat" : "Social"}</h2>
          </div>
          <div className="actions tight">
            {active && (
              <button className="text-btn" type="button" onClick={() => setThread(null)}>
                Posts
              </button>
            )}
            <button className="text-btn" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="subtitle left">
          {active
            ? "Messages on this score post."
            : "Write a post, add photos, or like, diamond, and chat on what is already here."}
        </p>
        {actionError && <p className="hint warn">{actionError}</p>}
        {!active && (
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void publishNote();
            }}
          >
            <textarea
              value={note}
              maxLength={2000}
              placeholder="Share something with Keep It Alive"
              onChange={(event) => setNote(event.target.value)}
            />
            {photos.length > 0 && (
              <div className="photo-drafts">
                {photos.map((photo) => (
                  <div className="photo-draft" key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="" />
                    <button type="button" aria-label="Remove photo" onClick={() => removePhoto(photo.id)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="composer-bar">
              <label className="secondary slim">
                Add photos
                <input
                  className="photo-input"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="primary slim"
                type="submit"
                disabled={busy === "compose" || (!note.trim() && photos.length === 0)}
              >
                {busy === "compose" ? "Posting…" : user ? "Post" : "Log in to post"}
              </button>
            </div>
          </form>
        )}

        {!active && status === "loading" && <p className="hint">Loading score posts…</p>}
        {!active && status === "error" && <p className="hint warn">{error}</p>}
        {!active && status === "ready" && posts.length === 0 && (
          <p className="hint">No score posts yet. Finish a run, log in, and post the score.</p>
        )}
        {!active && status === "ready" && posts.length > 0 && (
          <ul className="social-list">
            {posts.map((post) => (
              <li key={post.postHashHex}>
                <PostCard
                  post={post}
                  viewerKey={user?.publicKey}
                  pickerOpen={picker === post.postHashHex}
                  busy={busy.startsWith(post.postHashHex)}
                  onLike={() => void toggleLike(post)}
                  onTogglePicker={() => setPicker((current) => (current === post.postHashHex ? null : post.postHashHex))}
                  onDiamond={(level) => void giveDiamonds(post, level)}
                  onChat={() => {
                    setDraft("");
                    setActionError("");
                    setPicker(null);
                    setThread(post.postHashHex);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {active && (
          <div className="social-thread">
            <PostCard
              post={active}
              viewerKey={user?.publicKey}
              pickerOpen={picker === active.postHashHex}
              busy={busy.startsWith(active.postHashHex)}
              onLike={() => void toggleLike(active)}
              onTogglePicker={() => setPicker((current) => (current === active.postHashHex ? null : active.postHashHex))}
              onDiamond={(level) => void giveDiamonds(active, level)}
            />
            {!chat && <p className="hint">Loading chat…</p>}
            {chat?.error && <p className="hint warn">{chat.error}</p>}
            {chat && !chat.error && chat.comments.length === 0 && <p className="hint">No chats on this post yet.</p>}
            {chat && chat.comments.length > 0 && (
              <ul className="chat-list">
                {chat.comments.map((comment) => (
                  <li key={comment.postHashHex}>
                    <CommentRow comment={comment} />
                  </li>
                ))}
              </ul>
            )}
            {user ? (
              <form
                className="chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat(active);
                }}
              >
                <textarea
                  value={draft}
                  maxLength={500}
                  placeholder="Write a message"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button className="primary slim" type="submit" disabled={busy.endsWith(":chat") || !draft.trim()}>
                  {busy.endsWith(":chat") ? "Sending…" : "Send"}
                </button>
              </form>
            ) : (
              <button className="secondary slim" type="button" onClick={onLogin}>
                Log in to chat
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PostCard({
  post,
  viewerKey,
  pickerOpen,
  busy,
  onLike,
  onTogglePicker,
  onDiamond,
  onChat,
}: {
  post: SocialPost;
  viewerKey?: string;
  pickerOpen: boolean;
  busy: boolean;
  onLike: () => void;
  onTogglePicker: () => void;
  onDiamond: (level: number) => void;
  onChat?: () => void;
}) {
  const mine = viewerKey === post.publicKey;
  const name = post.username ? `@${post.username}` : shortKey(post.publicKey);
  return (
    <article className="social-card">
      <div className="social-who">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={profilePictureUrl(post.publicKey, post.username)} alt="" width={36} height={36} />
        <div>
          <strong>{post.score != null ? `${formatSeconds(post.score)}s · ${name}` : name}</strong>
          <span>
            {post.score != null ? `${post.near} near misses` : ""}
            {post.createdAt ? `${post.score != null ? " · " : ""}${formatWhen(post.createdAt)}` : ""}
          </span>
        </div>
      </div>
      {post.body && <p className="social-body">{post.body}</p>}
      {post.images.length > 0 && (
        <div className={post.images.length === 1 ? "social-photos single" : "social-photos"}>
          {post.images.map((src) => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" />
            </a>
          ))}
        </div>
      )}
      <div className="social-actions">
        <button className={post.likedByReader ? "on" : ""} type="button" onClick={onLike} disabled={busy}>
          {post.likedByReader ? "Liked" : "Like"} {post.likeCount}
        </button>
        <button
          className={post.diamondLevel > 0 ? "on" : ""}
          type="button"
          onClick={onTogglePicker}
          disabled={busy || mine}
        >
          Diamonds {post.diamondCount}
          {post.diamondLevel > 0 ? ` · you ◆${post.diamondLevel}` : ""}
        </button>
        {onChat && (
          <button type="button" onClick={onChat}>
            Reply {post.commentCount}
          </button>
        )}
      </div>
      {mine && <p className="hint">Diamonds go to other players.</p>}
      {pickerOpen && !mine && (
        <div className="diamond-picker">
          {DIAMONDS.map((diamond) => (
            <button
              key={diamond.level}
              type="button"
              disabled={busy || diamond.level <= post.diamondLevel}
              onClick={() => onDiamond(diamond.level)}
            >
              ◆{diamond.level}
              <small>{formatDiamondCost(diamond.nanos)}</small>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function CommentRow({ comment }: { comment: SocialComment }) {
  const name = comment.username ? `@${comment.username}` : shortKey(comment.publicKey);
  return (
    <div className="chat-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={profilePictureUrl(comment.publicKey, comment.username)} alt="" width={28} height={28} />
      <div>
        <strong>
          {name}
          {comment.createdAt ? <small> · {formatWhen(comment.createdAt)}</small> : null}
        </strong>
        <p>{comment.body}</p>
      </div>
    </div>
  );
}

function formatDiamondCost(nanos: number): string {
  const deso = nanos / 1e9;
  const text = deso >= 1 ? String(deso) : deso.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} DESO`;
}
