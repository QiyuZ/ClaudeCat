# ClaudeCat — a Claude Code usage desktop pet (Windows)

A small transparent widget pinned to the top-right of the desktop: a hand-drawn cat that
shows Claude Code's **5-hour** (and, in the detail panel, **weekly**) usage in real time.
The cat's pose/mood tracks how tight the budget is — the more you've used, the more tired it
looks. Positioning: a shareable, open-source portfolio / toy project.

> **Language: everything in this repo is English** — code, UI strings, comments, and docs.

## Status: V1 implemented

- Tauri v2 + React-TS. Transparent / frameless / always-on-top / not-in-taskbar draggable
  window, top-right anchored, optional launch-on-login.
- **Real data** via a Claude Code statusline hook (`scripts/statusline.js`) that caches the
  official `rate_limits` payload to `~/.claude/cc-pet-usage.json`; Rust polls it and pushes
  updates to the UI. No separate login — it uses whatever account Claude Code is signed into.
- **Sprite cat**: the four hand-drawn strips in `src/pic/` are sliced by
  `scripts/process_sprites.py` into transparent per-frame PNGs in `src/assets/cat/`. Moods
  map to frames; the relaxed mood is an animated grooming loop.
- **Organic 5h indicator**: a slim fuel gauge + a soft, breathing `Reset in mm:ss` line under
  the cat (not a pair of bare progress bars). Weekly detail lives in the click-to-expand
  panel.
- First-run onboarding installs the statusline hook with one click (and refuses to clobber a
  user's existing `statusLine`). Tray menu: show/hide, install hook, reset position, toggle
  click-through, quit.

## Architecture

- **Mood is driven by the tighter window**: `load = max(5h%, weekly%)` → `moodFor()` in
  [src/pet/stateMachine.ts](src/pet/stateMachine.ts). Tiers: `chill` (< 70) → `tired` (≥ 70)
  → `weary` (≥ 90) → `sleeping` (= 100, rate-limited).
- **Character visuals are isolated** in [src/characters/cat.tsx](src/characters/cat.tsx): a
  `Mood → frames` table plus a tiny frame-cycler. This is the only file that knows what the
  animal looks like — swap it to add a dog.
- **Data layering**: ① statusline stdin `rate_limits` (official, exact 5h + weekly, zero
  login — the source we use) → cache JSON → Rust poll → UI. ② JSONL activity detection and
  ③ an OAuth `/usage` fallback are possible future sources. Field names have varied across
  Claude Code versions (`five_hour|session`, `seven_day|weekly`, `used_percentage|percent`);
  `statusline.js` normalizes defensively, and `CC_PET_DEBUG=1` dumps raw stdin to verify.
- **The statusline must pass through**: Claude Code allows only one `statusLine`, so the
  installer never overwrites a foreign one; the hook also prints a short terminal line.
- **Window fits its content**: `set_view("cat"|"setup"|"panel")` in
  [src-tauri/src/lib.rs](src-tauri/src/lib.rs) resizes the transparent window per layout so
  empty transparent area never swallows desktop clicks. Click-through is a manual tray toggle
  for the whole window; per-pixel "only the cat is clickable" is left for later.

## Sprite pipeline

Source art: `src/pic/{chill,sad,typing,lick hand} cat.png`, each a strip of 4 poses on white.
`scripts/process_sprites.py` (needs `Pillow numpy scipy`) knocks out the white background to
transparent, auto-detects frame boundaries (gap-detection, falling back to equal quarters for
the overlapping landscape sheets), keeps the main cat blob + nearby icons while dropping
neighbor bleed, trims, and exports bottom-anchored 320px squares. V1 uses `chill-0` + the
`groom` frames (relaxed loop) and `sad-0/2/3` (tired → weary → asleep). The `typing` frames
are sliced and reserved for a future "actively working" state.

## Develop

Prereqs: Node, Rust (MSVC toolchain + VS C++ Build Tools), cargo on PATH (`~/.cargo/bin`).

```powershell
npm install
npm run tauri dev     # dev run (first compile takes a while)
npm run tauri build   # package .msi / .exe
```

Reference projects: `ohugonnot/claude-code-statusline` (data layer), `ccusage` (JSONL
parsing), `JohnPrk/token-panda` and `renatoaug/Clauddy` (desktop pet / mood design).
