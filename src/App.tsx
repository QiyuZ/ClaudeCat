import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Cat } from "./characters/cat";
import { QuotaGauge } from "./components/QuotaGauge";
import { WeeklyHearts } from "./components/WeeklyHearts";
import { PetMenu, ANIM_MS, type AnimSpeed, type CatSize } from "./components/PetMenu";
import { useUsage } from "./pet/useUsage";
import { isRateLimited, moodFor } from "./pet/stateMachine";
import "./App.css";

// On-screen cat sizes ("zoom"). w = window width, catH = cat stage height in px.
const SIZES: Record<CatSize, { w: number; catH: number }> = {
  s: { w: 140, catH: 96 },
  m: { w: 156, catH: 118 },
  l: { w: 192, catH: 152 },
};

function loadAnim(): AnimSpeed {
  const v = localStorage.getItem("ccpet.anim");
  return v && v in ANIM_MS ? (v as AnimSpeed) : "lively";
}
function loadSize(): CatSize {
  const v = localStorage.getItem("ccpet.size");
  return v === "s" || v === "m" || v === "l" ? v : "m";
}

function App() {
  const { usage, status, active } = useUsage();
  const [install, setInstall] = useState<{ phase: "idle" | "working" | "done" | "error"; msg: string }>(
    { phase: "idle", msg: "" },
  );
  const [anim, setAnim] = useState<AnimSpeed>(loadAnim);
  const [size, setSize] = useState<CatSize>(loadSize);
  const [menuOpen, setMenuOpen] = useState(false);
  // Weekly hearts are a hover reveal: they show while the pointer is over the widget and
  // slip away once it leaves — never a sticky panel you have to click closed again.
  const [weeklyHover, setWeeklyHover] = useState(false);
  const [hookReady, setHookReady] = useState(false);
  const [, tick] = useState(0);

  const nodata = status === "nodata" || !usage;
  const rateLimited = usage ? isRateLimited(usage) : false;

  // Fast ticking only while asleep (for the mm:ss whisper); slow otherwise.
  useEffect(() => {
    const period = rateLimited ? 1000 : 30_000;
    const id = setInterval(() => tick((n) => n + 1), period);
    return () => clearInterval(id);
  }, [rateLimited]);

  // Size the transparent window to hug the current layout so empty area never eats
  // desktop clicks: setup card, open menu, or cat (+ 5h gauge, + optional weekly chip).
  const weeklyShown = weeklyHover && !menuOpen;
  const bodyH = SIZES[size].catH + 46 + (weeklyShown ? 44 : 0);
  const dims: [number, number] = nodata
    ? [216, 268]
    : menuOpen
    ? [220, 384]
    : [Math.max(SIZES[size].w, 150), bodyH];
  const lastDims = useRef<string>("");
  useEffect(() => {
    const key = dims.join("x");
    if (lastDims.current === key) return;
    lastDims.current = key;
    invoke("set_window", { w: dims[0], h: dims[1] }).catch(() => {});
  }, [dims]);

  // The transparent window is tiny, so the in-window backdrop can't catch clicks that
  // land on other apps. While the menu is open we grab focus and also dismiss it on
  // Escape/Enter or when the window loses focus (i.e. you click anywhere else).
  useEffect(() => {
    if (!menuOpen) return;
    const w = getCurrentWindow();
    w.setFocus().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Consider focus "settled" shortly after opening so a later blur (click-away) closes
    // the menu even if the window was already focused from the right-click itself.
    let gained = false;
    const settle = window.setTimeout(() => (gained = true), 200);
    let un: (() => void) | undefined;
    w.onFocusChanged(({ payload: focused }) => {
      if (focused) gained = true;
      else if (gained) setMenuOpen(false);
    }).then((f) => (un = f));
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(settle);
      un?.();
    };
  }, [menuOpen]);

  // Know whether the hook is already registered, so a connected-but-idle widget says
  // "waiting for usage" rather than prompting to connect again.
  useEffect(() => {
    invoke<boolean>("hook_installed").then(setHookReady).catch(() => {});
  }, []);

  async function handleInstall() {
    setInstall({ phase: "working", msg: "" });
    try {
      await invoke<string>("install_statusline");
      setInstall({ phase: "done", msg: "" });
    } catch (e) {
      setInstall({ phase: "error", msg: String(e) });
    }
  }

  function chooseAnim(a: AnimSpeed) {
    setAnim(a);
    localStorage.setItem("ccpet.anim", a);
  }
  function chooseSize(s: CatSize) {
    setSize(s);
    localStorage.setItem("ccpet.size", s);
  }
  function menuAction(a: "reset_pos" | "hide" | "quit") {
    setMenuOpen(false);
    invoke("window_action", { action: a }).catch(() => {});
  }

  // Typing overrides the idle mood while a task runs — but never while rate-limited
  // (asleep) or before we have data: a working cat should still be awake.
  const mood = usage
    ? active && !rateLimited
      ? "typing"
      : moodFor(usage)
    : "chill";

  // Drag to move; a clean left-click toggles the weekly detail; right-click opens the menu.
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > 3 || Math.abs(e.clientY - p.y) > 3) {
      p.moved = true;
      press.current = null;
      getCurrentWindow().startDragging().catch(() => {});
    }
  }
  function onPointerUp() {
    // Drag is handled in onPointerMove; a clean click no longer toggles anything, since
    // the weekly detail is now a hover reveal.
    press.current = null;
  }
  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuOpen(true);
  }

  return (
    <div
      className="widget"
      onMouseEnter={() => setWeeklyHover(true)}
      onMouseLeave={() => setWeeklyHover(false)}
    >
      <div
        className="stage"
        style={{ height: SIZES[size].catH, cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        title="Drag to move · right-click for options"
      >
        <Cat mood={nodata ? "chill" : mood} restMs={ANIM_MS[anim]} />
      </div>

      {!nodata && usage && <QuotaGauge usage={usage} />}

      {!nodata && usage && weeklyShown && <WeeklyHearts usage={usage} />}

      {nodata && (
        <div className="setup">
          {install.phase === "done" ? (
            <>
              <div className="setup-title">✓ Connected!</div>
              <div className="setup-steps">
                Now open a terminal and run <code>claude</code> once.
                <br />
                The cat wakes up on its own.
              </div>
            </>
          ) : install.phase === "error" ? (
            <>
              <div className="setup-title">Couldn&apos;t auto-connect</div>
              <div className="setup-steps">{install.msg}</div>
              <button className="setup-btn" onClick={handleInstall} type="button">
                Try again
              </button>
            </>
          ) : hookReady ? (
            <>
              <div className="setup-title">Waiting for usage…</div>
              <div className="setup-hint">
                Send a message in Claude&nbsp;Code and the cat wakes up.
              </div>
            </>
          ) : (
            <>
              <div className="setup-title">Waiting for Claude&nbsp;Code…</div>
              <button
                className="setup-btn"
                onClick={handleInstall}
                disabled={install.phase === "working"}
                type="button"
              >
                {install.phase === "working" ? "Setting up…" : "Connect ClaudeCat"}
              </button>
              <div className="setup-hint">One click to link your usage.</div>
            </>
          )}
        </div>
      )}

      {menuOpen && (
        <PetMenu
          anim={anim}
          size={size}
          onAnim={chooseAnim}
          onSize={chooseSize}
          onAction={menuAction}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
