import { useEffect, useState } from "react";
import type { Mood } from "../pet/stateMachine";

// The cat's visual layer. Each mood maps to a resting frame plus, optionally, a short
// animation it plays *occasionally* (so the cat is calm, not fidgeting). Frames are
// sliced from the hand-drawn strips in src/pic by scripts/process_sprites.py. This is
// the ONLY file that knows what the character looks like — swap it to add a dog later.

import groom0 from "../assets/cat/groom-0.png";
import groom1 from "../assets/cat/groom-1.png";
import groom2 from "../assets/cat/groom-2.png";
import sad0 from "../assets/cat/sad-0.png";
import sad2 from "../assets/cat/sad-2.png";
import sad3 from "../assets/cat/sad-3.png";
import typing0 from "../assets/cat/typing-0.png";
import typing1 from "../assets/cat/typing-1.png";
import typing2 from "../assets/cat/typing-2.png";
import typing3 from "../assets/cat/typing-3.png";

interface CatProps {
  mood: Mood;
  /** Idle rest cadence in ms (from the tray "Animation" menu); 0 = still, breathe only. */
  restMs?: number;
}

// frames[0] is the resting pose, held for restMs; the remaining frames play once (a
// quick paw-lick) at frameMs each, then it settles back to resting. Single-frame moods
// just sit and breathe. `loop` moods (typing) instead cycle all frames endlessly at
// frameMs, ignoring the idle cadence — a busy, working animation.
interface Anim {
  frames: string[];
  frameMs: number;
  restMs: number;
  loop?: boolean;
}
const FRAMES: Record<Mood, Anim> = {
  chill: { frames: [groom0, groom1, groom2, groom1], frameMs: 320, restMs: 13000 },
  typing: { frames: [typing0, typing1, typing2, typing3], frameMs: 190, restMs: 0, loop: true },
  tired: { frames: [sad0], frameMs: 0, restMs: 0 },
  weary: { frames: [sad2], frameMs: 0, restMs: 0 },
  sleeping: { frames: [sad3], frameMs: 0, restMs: 0 },
};

// Warm the browser cache once so mood changes don't flash a blank frame.
const ALL = [groom0, groom1, groom2, sad0, sad2, sad3, typing0, typing1, typing2, typing3];
let preloaded = false;
function preload() {
  if (preloaded) return;
  preloaded = true;
  for (const src of ALL) {
    const img = new Image();
    img.src = src;
  }
}

export function Cat({ mood, restMs }: CatProps) {
  const { frames, frameMs, restMs: defaultRest, loop } = FRAMES[mood];
  // A looping (working) mood keeps its own fast cadence; other moods honor the idle
  // cadence chosen in the tray menu.
  const rest = loop ? frameMs : restMs ?? defaultRest;
  const [i, setI] = useState(0);

  useEffect(() => {
    preload();
  }, []);

  useEffect(() => {
    setI(0);
    if (loop) {
      // Endless uniform cycle through every frame — the busy "typing" animation.
      let idx = 0;
      let timer: number;
      const step = () => {
        setI(idx);
        idx = (idx + 1) % frames.length;
        timer = window.setTimeout(step, frameMs);
      };
      step();
      return () => window.clearTimeout(timer);
    }
    if (frames.length < 2 || rest <= 0) return; // single-frame moods, or "still" mode
    let idx = 0;
    let timer: number;
    const step = () => {
      setI(idx);
      const delay = idx === 0 ? rest : frameMs;
      idx = (idx + 1) % frames.length;
      timer = window.setTimeout(step, delay);
    };
    step();
    return () => window.clearTimeout(timer);
  }, [mood, frames, frameMs, rest, loop]);

  return (
    <img
      className={`cat cat--${mood}`}
      src={frames[i]}
      alt={`cat feeling ${mood}`}
      draggable={false}
    />
  );
}
