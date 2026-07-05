# ClaudeCat — a Claude Code usage desktop pet (Windows)

A small transparent widget pinned to the top-right of the desktop: a hand-drawn cat that
shows Claude Code's **5-hour** (and, on hover, **weekly**) usage in real time. The cat's
pose/mood tracks how tight the budget is — the more you've used, the more tired it looks —
and while a task is running the cat **types**. Positioning: a shareable, open-source
portfolio / toy project.

> **Language: everything in this repo is English** — code, UI strings, comments, and docs.

## Status: V1 shipped

- Tauri v2 + React-TS. Transparent / frameless / always-on-top / not-in-taskbar draggable
  window, top-right anchored on launch, optional launch-on-login (tray toggle).
- **Real data, two sources** (Rust merges them, preferring whichever is fresh + has data):
  1. A Claude Code **statusline hook** (`scripts/statusline.js`) that caches the official
     `rate_limits` payload to `~/.claude/cc-pet-usage.json`.
  2. An **OAuth `/api/oauth/usage`** fallback in Rust that reads the token Claude Code already
     stores and fetches exact 5h/weekly usage — this is what works when a Claude Code version
     doesn't emit `rate_limits` to the statusline (common). Writes `cc-pet-usage-oauth.json`.
  No separate login — it uses whatever account Claude Code is signed into.
- **Typing pose**: exact task-in-progress detection via `UserPromptSubmit`/`Stop` hooks
  (`scripts/cc-pet-activity.js`) that flip `~/.claude/cc-pet-busy.json`; falls back to a
  transcript-mtime heuristic when those hooks aren't installed.
- **Sprite cat**: hand-drawn strips in `src/pic/` are sliced by `scripts/process_sprites.py`
  into transparent per-frame PNGs in `src/assets/cat/`. Moods map to frames; relaxed and
  typing are animated loops.
- **Indicators**: a chunky glossy 5h "fuel" gauge with a paw + reset countdown under the cat;
  the weekly budget shows as a row of **hearts** on hover (a health bar that depletes).
- First-run onboarding / the tray installs the hooks with one click (never clobbers a user's
  existing `statusLine`; merges activity hooks alongside any the user has). Tray menu:
  show/hide, install hooks, reset position, toggle click-through, start on login, quit.

## Architecture

- **Mood is driven by the tighter window**: `load = max(5h%, weekly%)` → `moodFor()` in
  [src/pet/stateMachine.ts](src/pet/stateMachine.ts). Tiers: `chill` (< 90) → `tired` (≥ 90)
  → `weary` (≥ 97) → `sleeping` (≥ `RATE_LIMIT_PCT` = 99.5, rate-limited). `typing` is a
  separate overlay set in [src/App.tsx](src/App.tsx) from the live `active` flag (suppressed
  while asleep).
- **Character visuals are isolated** in [src/characters/cat.tsx](src/characters/cat.tsx): a
  `Mood → frames` table plus a frame-cycler (single-shot idle animations, or `loop` moods
  like typing). This is the only file that knows what the animal looks like — swap it to add
  a dog.
- **Data flow**: statusline cache + OAuth cache + transcript mtimes → `read_usage()` in
  [src-tauri/src/lib.rs](src-tauri/src/lib.rs) merges/classifies (`ok`/`stale`/`nodata` +
  `active`) → 3s poll emits `usage-updated` → [src/pet/useUsage.ts](src/pet/useUsage.ts) →
  UI. A both-null snapshot is reported as `nodata` (a real "waiting" state, never a fake 0%).
  Field names vary across Claude Code versions; `statusline.js` normalizes defensively and
  `CC_PET_DEBUG=1` dumps raw stdin.
- **Hooks must pass through / merge**: Claude Code allows only one `statusLine`, so the
  installer never overwrites a foreign one; the activity hooks are merged into any existing
  `hooks` (idempotent, marked by the `cc-pet-activity` string). Settings are backed up first.
- **Window fits its content**: `set_window(w, h)` in lib.rs resizes the transparent window
  per layout (cat, +weekly hearts, menu, toast) so empty transparent area never swallows
  desktop clicks, and keeps the **right edge fixed** so growth/drags never snap the cat back
  to the corner. Click-through is a manual tray toggle; per-pixel hit-testing is left for later.

## Sprite pipeline

Source art: `src/pic/{chill,sad,typing,lick hand} cat.png`, each a strip of 4 poses on white.
`scripts/process_sprites.py` (needs `Pillow numpy scipy`) knocks out the white background,
auto-detects frame boundaries (gap-detection, falling back to equal quarters for the
overlapping landscape sheets), keeps the main cat blob + nearby icons while dropping neighbor
bleed, trims, and exports bottom-anchored 320px squares. In use: `groom-0/1/2` (relaxed loop),
`typing-0..3` (typing loop), `sad-0/2/3` (tired → weary → asleep). `scripts/make_state_gifs.py`
composites these into the README's `docs/*.gif`.

## Develop

Prereqs: Node, Rust (MSVC toolchain + VS C++ Build Tools), cargo on PATH (`~/.cargo/bin`).

```powershell
npm install
npm run tauri dev     # dev run (first compile takes a while)
npm run tauri build   # package .msi / -setup.exe + standalone claudecat.exe
```

Releases are built by [.github/workflows/release.yml](.github/workflows/release.yml) on a
`v*` tag push (tauri-action + a portable `claudecat.exe` asset).

Reference projects: `ohugonnot/claude-code-statusline` (statusline data layer),
`Maciek-roboblog/Claude-Code-Usage-Monitor` and `ccusage` (JSONL / data sources),
`JohnPrk/token-panda` and `renatoaug/Clauddy` (desktop pet / mood design).
