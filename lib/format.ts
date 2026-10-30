export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function beatScore(seconds: number, target: number): boolean {
  return Number(formatSeconds(seconds)) > Number(formatSeconds(target));
}

export function shortKey(publicKey: string): string {
  if (publicKey.length < 12) return publicKey;
  return `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`;
}

export function profilePictureUrl(publicKey: string, label?: string): string {
  const node = (
    process.env.NEXT_PUBLIC_DESO_NODE_URI || "https://node.deso.org"
  ).replace(/\/$/, "");
  const name = (label || publicKey.slice(0, 8)).replace(/^@/, "");
  const fallback = encodeURIComponent(
    `https://ui-avatars.com/api/?size=64&background=101621&color=67f4e2&bold=true&name=${encodeURIComponent(name)}`
  );
  return `${node}/api/v0/get-single-profile-picture/${encodeURIComponent(publicKey)}?fallback=${fallback}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
