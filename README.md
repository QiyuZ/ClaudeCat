# 🐱 ClaudeCat

A tiny hand-drawn cat that lives in the top-right corner of your desktop and shows your
**Claude Code** usage. The cat is transparent, frameless and draggable — the busier your
budget gets, the more tired the cat looks:

| Load (of the fuller of the 5h / weekly windows) | Cat |
| --- | --- |
| plenty of headroom (< 90%) | 🧘 relaxed, grooming itself |
| nearly out (≥ 90%) | 😔 sitting, droopy-eyed |
| right at the edge (≥ 97%) | 😩 lying down, worn out |
| rate-limited (100%) | 😴 curled up asleep, with a faint **`Reset in 02:40`** breathing beside it |

Under the cat is a slim **5h** usage bar (% used, matching Claude Code's `/status`) with a
soft reset countdown. **Left-click** the cat to reveal the **weekly** figure.

**Interact:** left-click for the weekly detail · drag the cat to move it · **right-click**
for a menu (animation speed, cat size / zoom, reset position, hide, quit). Settings persist
across restarts.

![four cat states](preview.png)

## Where the numbers come from

ClaudeCat reads **your own** Claude Code usage — it does not ask you to log in again and it
does not scrape anything. Claude Code renders a *statusline* on every turn and hands the
script the official `rate_limits` payload (exact 5-hour + weekly percentages and reset
times). ClaudeCat installs a small statusline hook that caches that payload to
`~/.claude/cc-pet-usage.json`; the widget polls the cache. So the numbers are exactly what
Claude Code itself reports, for whatever account Claude Code is already signed into. Zero
extra auth, and it works for any user who installs the app.

Two robustness notes baked into the hook/widget:

- `rate_limits` only appears **after an API response** in a session, so some renders omit
  it. The hook **carries forward** the last-known 5h/weekly values instead of blanking them,
  so the numbers don't flicker between responses — but only for up to **3 hours**, after
  which stale data is dropped rather than shown (the 5h window has rolled by then, so an
  older figure would just disagree with `/status`).
- `resets_at` is Unix **epoch seconds**; the hook converts it to a real timestamp and the
  widget shows the true countdown to it.

## Install (end users)

1. Download and run the installer (`ClaudeCat_x.y.z_x64.msi`) from Releases.
2. The cat appears top-right. On first run it shows **"Waiting for Claude Code…"** with a
   **Connect ClaudeCat** button — click it (or the tray icon → *Install statusline hook*).
   This registers the hook in `~/.claude/settings.json`. If you already have a custom
   `statusLine`, ClaudeCat refuses to overwrite it — see [Manual setup](#manual-setup).
3. Send a message in any Claude Code session. Within a few seconds the cat wakes up with
   live data.

Right-click the cat for per-pet options (animation, size, reset position, hide, quit). The
tray icon also has: show/hide, install hook, reset position, toggle click-through (let clicks
pass through to the desktop), and quit. The app can start on login.

### Manual setup

If you keep your own statusline, add ClaudeCat as a pass-through instead. The hook prints a
short `🐱 5h .. · wk .. left` line, so you can chain it, or point `settings.json` at the
bundled script:

```jsonc
// ~/.claude/settings.json
{
  "statusLine": { "type": "command", "command": "node \"C:\\Users\\<you>\\.claude\\cc-pet\\statusline.js\"" }
}
```

Set the env var `CC_PET_DEBUG=1` to also dump the raw statusline stdin to
`~/.claude/cc-pet-debug.json` — handy if a Claude Code version renames the `rate_limits`
fields.

## Develop

Requires Node and the Rust MSVC toolchain (Rust + VS C++ Build Tools) for Tauri v2.

```powershell
npm install
npm run tauri dev     # dev run (first compile takes a few minutes)
npm run tauri build   # produce .msi / .exe in src-tauri/target/release/bundle
```

The cat art is sliced from the four hand-drawn strips in `src/pic/` by a one-off script that
knocks out the white background, auto-detects the frames and trims them to transparent PNGs:

```powershell
pip install Pillow numpy scipy
python scripts/process_sprites.py   # -> src/assets/cat/*.png
python scripts/preview_widget.py    # -> preview.png (optional layout check)
```

## How it works

- `src/pet/stateMachine.ts` — turns usage % into a mood (`load = max(5h, weekly)`), plus the
  reset-countdown helpers.
- `src/characters/cat.tsx` — the only file that knows what the character looks like: maps
  each mood to sprite frames (the relaxed mood plays an occasional idle paw-lick). Swap this
  to add a dog later.
- `src/components/QuotaGauge.tsx` — the 5h usage bar and reset countdown under the cat
  (weekly shows on left-click, from `App.tsx`).
- `src/components/PetMenu.tsx` — the right-click menu (animation, cat size, actions).
- `src/App.tsx` — composition, first-run onboarding, drag/right-click handling; asks Rust to
  resize the transparent window to fit each layout so empty area never eats desktop clicks.
- `scripts/statusline.js` — the Claude Code statusline hook that caches `rate_limits`
  (carries forward last-known values when a render omits it).
- `src-tauri/src/lib.rs` — transparent, frameless, always-on-top, no-taskbar window;
  top-right positioning; tray menu; click-through; autostart; usage-cache polling; window
  sizing; and the hook installer (which will not clobber a foreign `statusLine`).

## Roadmap

- **V1 (this)** — transparent sprite cat, real 5h/weekly data via statusline, robust reset
  countdown, right-click controls (animation / size), onboarding, MSI packaging.
- **Next** — "actively working" pose from JSONL activity (the typing-cat frames are already
  sliced and waiting); weekly heat-map; optional dog character.
