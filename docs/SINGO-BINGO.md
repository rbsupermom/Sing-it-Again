# Singo-Bingo first build

Source specification: https://app.notion.com/p/3e7f75b164ba8118a3fecf549b665f1d

Implemented September 26, 2026. This is a review build, not a verified production release.

## What players get

Open Backstage, then Singo-Bingo. Either member can create the initial invitation and becomes the host. The other member accepts in the game screen. No email, chat message, push notification, or external invitation is sent automatically.

The host reviews an editable shared pool before creating the first game. The bundled pool has 129 unique normalized titles, independent of account libraries. Both players may review the pool before accepting. Pool assignments stay fixed through same-night rematches. The initial host continues to host subsequent rounds in this first version.

- Traditional: 48 different card songs across two 5×5 cards, plus room for two center choices. Minimum pool: 50 unused songs.
- Turn Up the Heat: no duplicate songs within one card; songs may overlap across players. Minimum pool: 26 unused songs.
- Shared, nonrepeating B/I/N/G/O calls. Only the host can call.
- Called squares reveal songs on tap. Revealing does not earn or reserve a song.
- Center requires a chosen song and a confirmed performance. Center choices can be outside the pool.
- Five actually earned squares in any row, column, or diagonal wins.
- Heat claims permanently block the other player's matching square, including hidden squares. Replacements do not restore it.
- Performance confirmation and a confirmation dialog help avoid accidental claims.
- The singer of the latest performance can undo it until another performance is recorded. Claims, blocked squares, and the winner are recomputed.
- If all bingo lines on both cards are blocked, the result is a draw.
- Same-night rematches exclude songs already performed. A checked “different karaoke night” option resets exclusions and archives the previous night.

## Build choices and limitations

Two players only. Same-title cover versions count as the same song, regardless of artist. Identity normalizes case, punctuation, accents, karaoke original-artist labels, and common remaster suffixes. This is not fuzzy matching of arbitrary misspellings; review the shared pool together.

A center cannot duplicate a song on the same player's own card, consistent with avoiding within-card duplicates. In Heat it may duplicate the other player's card/center. Traditional unavailable-center errors never identify the conflicting card or song assignment.

A shared song goes to the first **confirmed online transaction**, not a measured microphone performance time. Players report honestly. No audio recognition, venue integration, or prize adjudication is provided. Offline play is read-only and cannot queue claims.

Hidden titles are hidden in the UI. The shared room contains the seed and catalog, so a technical player could inspect assignments. This is a trusted-friends game, not a server-secret or tamper-proof competitive service. Rules authenticate actors, protect history and restrict host commands. The shared deterministic engine ignores semantically invalid commands and derives progress consistently. A future untrusted-player version would require trusted server execution and per-player secret cards.

The pool is editable before the first invite; pool editing and host transfer after room creation are follow-up work. Personal song libraries and performance history are not automatically modified by game performances. Archived nights are stored but have no history browser yet. Each night supports 1,500 commands, plus an end-round command, before starting a new night.

## Persistence

`pairs/{pairId}/singo/current` stores immutable setup plus an append-only numbered event map. Actions run in Firestore transactions. Conflicting claims retry against the latest room; losing claims fail without overwriting progress. Replays derive boards, claims, blocks and winners after reconnects. Round number and session ID guard against stale dialogs from previous rounds/nights.

`pairs/{pairId}/singoArchive/{sessionId}` stores exact, immutable copies when a new night begins. Only the existing private Backstage pair can read games or archives. Personal libraries are separate. Signing out/switching pair stops subscriptions and suppresses stale callbacks.

## Validation completed

- `npm run check`: syntax passes.
- `npm test`: 24 tests pass: 13 game-engine tests, 5 DOM interaction tests, 6 existing Backstage regression tests.
- `npm run test:rules`: 2 Firebase emulator suites pass, including original account/Backstage privacy rules and two authenticated game clients.
- Emulator game test covers concurrent conflicting claims (exactly one succeeds), reconnect equivalence, spoofed actors, outsider reads/writes, non-host calls, immutable history, center validation, correction, rematches, new-night archive persistence, and stale-session rejection.
- No production accounts, personal libraries, or live game documents were changed during testing.

## Required release steps

1. Review the existing production Firestore rules and compare them with the repository baseline before applying the additive game rules. Do not overwrite unrelated rules edited outside GitHub.
2. Publish the game rules from `firestore.rules` to the app's Firebase project. The browser's automatic approval review blocked the Google account redirect during this session, so deployment has not happened.
3. Merge the application change to `main` and verify the GitHub Pages deployment. Service worker cache version is bumped to pick up the new modules.
4. Check the actual mobile layout, Google sign-in, and invitation acceptance with two test accounts. Browser preview was blocked for localhost and file URLs in this environment; DOM tests are not a substitute for a rendered phone check.
5. Smoke-test Traditional and Heat, close/reopen both devices, and record production results in Notion.

Firebase rules must be deployed before the front-end release. The UI shows a specific setup message if game access is denied, while existing Backstage remains available.
