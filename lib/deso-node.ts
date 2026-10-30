export function desoNode(): string {
  return (
    process.env.DESO_NODE_URI ||
    process.env.NEXT_PUBLIC_DESO_NODE_URI ||
    "https://node.deso.org"
  ).replace(/\/$/, "");
}

export const PUBLIC_KEY = /^BC[1-9A-HJ-NP-Za-km-z]{40,64}$/;
export const USERNAME = /^[A-Za-z0-9_]{1,25}$/;
