// The cat's own right-click menu — the discoverable place to control the pet (idle
// animation speed, on-screen size/zoom, and window actions). Rendered in-app as a small
// glass card; App grows the transparent window while it's open so it isn't clipped.

export type AnimSpeed = "lively" | "normal" | "calm" | "still";
export type CatSize = "s" | "m" | "l";

export const ANIM_MS: Record<AnimSpeed, number> = {
  lively: 2500,
  normal: 6000,
  calm: 20000,
  still: 0,
};

interface PetMenuProps {
  anim: AnimSpeed;
  size: CatSize;
  onAnim: (a: AnimSpeed) => void;
  onSize: (s: CatSize) => void;
  onAction: (a: "reset_pos" | "hide" | "quit") => void;
  onClose: () => void;
}

function Radio({ on }: { on: boolean }) {
  return <span className={`menu-radio ${on ? "is-on" : ""}`} />;
}

export function PetMenu({ anim, size, onAnim, onSize, onAction, onClose }: PetMenuProps) {
  const anims: [AnimSpeed, string][] = [
    ["lively", "Lively"],
    ["normal", "Normal"],
    ["calm", "Calm"],
    ["still", "Still"],
  ];
  const sizes: [CatSize, string][] = [
    ["s", "Small"],
    ["m", "Medium"],
    ["l", "Large"],
  ];

  return (
    <>
      <div className="menu-backdrop" onPointerDown={onClose} />
      <div className="menu" role="menu">
        <div className="menu-head">Animation</div>
        {anims.map(([k, label]) => (
          <button key={k} className="menu-item" onClick={() => onAnim(k)} type="button">
            <Radio on={anim === k} />
            {label}
          </button>
        ))}
        <div className="menu-sep" />
        <div className="menu-head">Cat size</div>
        {sizes.map(([k, label]) => (
          <button key={k} className="menu-item" onClick={() => onSize(k)} type="button">
            <Radio on={size === k} />
            {label}
          </button>
        ))}
        <div className="menu-sep" />
        <button className="menu-item plain" onClick={() => onAction("reset_pos")} type="button">
          Reset position
        </button>
        <button className="menu-item plain" onClick={() => onAction("hide")} type="button">
          Hide
        </button>
        <button className="menu-item plain danger" onClick={() => onAction("quit")} type="button">
          Quit ClaudeCat
        </button>
      </div>
    </>
  );
}
