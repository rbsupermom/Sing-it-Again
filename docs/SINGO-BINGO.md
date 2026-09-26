# Singo-Bingo first build

Source specification: https://app.notion.com/p/3e7f75b164ba8118a3fecf549b665f1d

First release published September 26, 2026 (PR #2). Becca reported that both players love it. The September 26 history-link update adds the integration below.

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

The pool is editable before the first invite; pool editing and host transfer after room creation are follow-up work. Confirmed performances now flow into each singer’s personal History, Home statistics, Tonight list, and song counts. Archived game logs supply past-round performances; there is no separate archived-card browser. Each night supports 1,500 commands, plus an end-round command, before starting a new night.

## Persistence

`pairs/{pairId}/singo/current` stores immutable setup plus an append-only numbered event map. Actions run in Firestore transactions. Conflicting claims retry against the latest room; losing claims fail without overwriting progress. Replays derive boards, claims, blocks and winners after reconnects. Round number and session ID guard against stale dialogs from previous rounds/nights.

`pairs/{pairId}/singoArchive/{sessionId}` stores exact, immutable copies when a new night begins. Only the existing private Backstage pair can read games or archives. Personal libraries are separate. Signing out/switching pair stops subscriptions and suppresses stale callbacks.

## Validation completed

- `npm run check`: syntax passes.
- `npm test`: 36 tests pass, including source reconciliation, actual Home/History/Tonight rendering, game rules, and Backstage listener regressions.
- `npm run test:rules`: 2 Firebase emulator suites pass, including original account/Backstage privacy rules and two authenticated game clients.
- Emulator game test covers concurrent conflicting claims (exactly one succeeds), reconnect equivalence, spoofed actors, outsider reads/writes, non-host calls, immutable history, center validation, correction, rematches, new-night archive persistence, and stale-session rejection.
- Automated tests use simulated accounts. Live verification may reconcile already-completed performances into the signed-in account, as requested; it does not invent game events or contact the other player.

## Backstage performance integration · September 26, 2026

- Challenges log only for the recipient who sings. Duets log once in each member’s account as Together. Singo logs only that player’s performances.
- A source ID makes replay/reconnect idempotent. History repairs itself from acknowledged shared snapshots if a personal save was interrupted. Cached/pending writes do not overwrite confirmed history.
- Host invitation starts or uses the current karaoke night; guest acceptance does the same on the guest’s device. Same-night rematches keep that night. An explicitly different game night creates a separate session when the current session belongs to the old game. A manually ended mapped night does not reopen on background snapshots.
- A six-AM local boundary keeps after-midnight singing together. Old open sessions from a different karaoke date are closed when a new automatic night is activated.
- New completion and game-command timestamps are verified server timestamps. Old records lacked exact performance times; backfill uses creation time and labels the time as estimated. Historical records do not activate old nights.
- Song title and artist match existing personal songs case-insensitively; otherwise a song is added. Preferences and pre-existing counts are preserved. Source removals from Singo undo remove only that linked performance and decrement its count.
- Current and archived game logs are replayed across all rounds. Completed challenges/duets are not limited to the recent-chat window.
- Rules accept older clients without timestamps, preserving rollout compatibility. Clients must reload to enable history reconciliation and new timestamps. Each partner’s history is saved when that partner opens the updated app; neither account can write the other’s private state.
- Source IDs prevent duplicate imports of a Backstage completion. They cannot determine whether a separately entered manual performance represents the same real-world song; such manual records remain intact.

## Deployment order

1. Compare production rules with the repository baseline, then publish the additive timestamp validation rules.
2. Merge the frontend and confirm GitHub Pages succeeds. Cache v9 includes the history module.
3. Verify the signed-in app, existing history recovery, and completion totals. Do not send test invites or invent performances in the live pair.
4. Record release and verification in the Notion project hub.
