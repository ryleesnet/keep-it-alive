export const APP_TAG = "KeepItAlive";
export const DESO_POST_URL = "https://diamondapp.com/posts/";

export function desoPostUrl(postHashHex: string): string {
  return `${DESO_POST_URL}${postHashHex}`;
}
