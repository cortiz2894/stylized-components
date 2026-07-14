"use client";

import { COLORS } from "@/components/shared/theme";
import styles from "./OverlaySwitcher.module.css";

export interface SwitcherOption {
  key: string;
  label: string;
}

export interface SwitcherRow {
  label: string;
  options: SwitcherOption[];
  active: string;
  onSelect: (key: string) => void;
}

/** Bottom-left dock of preset pickers (season, sky). Each row just reflects
 *  presets that live with their own system — GrassField/presets.ts and
 *  skyDome/constants — so adding a preset there shows up here for free. */
export default function OverlaySwitcher({ rows }: { rows: SwitcherRow[] }) {
  return (
    <div
      className={styles.dock}
      style={
        {
          "--overlay-bg": COLORS.bg,
          "--overlay-surface": COLORS.surface,
          "--overlay-border": COLORS.border,
          "--overlay-text": COLORS.text,
          "--overlay-accent": COLORS.accent,
        } as React.CSSProperties
      }
    >
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <span className={styles.label}>{row.label}</span>
          {row.options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => row.onSelect(opt.key)}
              className={`${styles.btn} ${row.active === opt.key ? styles.active : ""}`}
              title={`${opt.label} ${row.label.toLowerCase()}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
