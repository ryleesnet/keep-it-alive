# KEEP IT ALIVE

An endless survival game. Drag the orb, dodge the hazards, and see how many seconds you last. Log in with DeSo to post the score and challenge a friend to beat it. Connecting an X account posts the same challenge there too.

## Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). DeSo login works without extra keys. Copy `.env.example` to `.env.local` if you want a custom DeSo node or X posting.

## Play

Drag, or use arrow keys / WASD. Space or Enter starts a run. The score is how long you survive. Near misses are hazards that pass close without hitting you. Your best time stays in this browser.

A challenge link looks like `/?c=...`. Opening it shows the time to beat. If you last longer, the result screen says you took the lead and the post can mention that player.

## DeSo

**Log in with DeSo** opens [identity.deso.org](https://identity.deso.org). The app asks for permission to submit posts, with a small spending cap (0.02 DESO) that covers network fees. You can skip buying DESO during signup and still play. Posting itself needs a little DESO in the wallet for the fee.

**Post score** publishes a DeSo post with the time, near misses, a challenge link, and `#KeepItAlive`. You can mention a friend’s username. Their public profile is looked up before the mention is included. Posted runs show up under **Scores**, where you can copy the challenge link again.

Posts are tagged in `PostExtraData` with `App=KeepItAlive` so the scores list can find them later.

## X

Create an app in the X developer portal with OAuth 2.0 and user authentication. The callback URL has to match `X_REDIRECT_URI` exactly. Request scopes are `tweet.write`, `users.read`, and `offline.access`.

```bash
cp .env.example .env.local
```

Fill in `X_CLIENT_ID`, `X_CLIENT_SECRET` (if the app is confidential), `X_REDIRECT_URI`, and `X_TOKEN_SECRET` (16+ random characters). Restart the dev server. **Connect X** sends the player through X login. The access token stays in an encrypted httpOnly cookie and is never sent to the browser as JavaScript.

X posts include the score and challenge link. They do not @mention DeSo usernames, since that name belongs to a different network. DeSo mentions stay on the DeSo post.
