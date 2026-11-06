import { useState, type CSSProperties } from "react";
import { listColor } from "../lib/tree";
import { patchList, useData } from "../state/store";
import { LIST_COLORS, type List } from "../types";

/** A row of colors. Auto clears the choice, so the list inherits or takes its turn in the palette again. */
export function ColorSwatches({ list, onPicked }: { list: List; onPicked?: () => void }) {
  const pick = (color: string) => {
    void patchList(list.id, { color });
    onPicked?.();
  };
  return (
    <div className="swatches">
      {LIST_COLORS.map((c) => (
        <button
          key={c}
          className={`swatch ${list.color === c ? "on" : ""}`}
          style={{ background: c }}
          aria-label={`Use color ${c}`}
          aria-pressed={list.color === c}
          onClick={() => pick(c)}
        />
      ))}
      <button className={`swatch-auto ${list.color ? "" : "on"}`} onClick={() => pick("")}>
        Auto
      </button>
    </div>
  );
}

/** The dot beside a list's name. Tapping it opens the colors. */
export function ListColorDot({ list }: { list: List }) {
  const { lists } = useData();
  const [open, setOpen] = useState(false);
  return (
    <span className="color-dot-wrap">
      <button
        className="color-dot"
        style={{ "--c": listColor(lists, list.id) } as CSSProperties}
        aria-label={`Change color of ${list.name}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <span className="color-pop">
          <ColorSwatches list={list} onPicked={() => setOpen(false)} />
        </span>
      )}
    </span>
  );
}
