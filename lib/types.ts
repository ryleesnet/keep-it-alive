export type Challenge = {
  score: number;
  near: number;
  username?: string;
  publicKey?: string;
};

export type RunResult = {
  seconds: number;
  nearMisses: number;
  best: number;
  isBest: boolean;
};

export type DesoUser = {
  publicKey: string;
  username?: string;
};

export type XStatus = {
  configured: boolean;
  connected: boolean;
  username?: string;
  name?: string;
};

export type PostedScore = {
  postHashHex: string;
  score: number;
  near: number;
  challengedUsername?: string;
  challengedUsernames?: string[];
  createdAt: string | null;
};

export type DesoProfile = {
  username?: string;
  publicKey: string;
  description?: string;
};

export type SocialPost = {
  postHashHex: string;
  publicKey: string;
  username?: string;
  score: number | null;
  near: number;
  body: string;
  images: string[];
  createdAt: string | null;
  likeCount: number;
  diamondCount: number;
  commentCount: number;
  likedByReader: boolean;
  diamondLevel: number;
};

export type SocialComment = {
  postHashHex: string;
  publicKey: string;
  username?: string;
  body: string;
  createdAt: string | null;
};
