"use client";

import { COLORS } from "@/components/shared/theme";
import { GRASS_PRESETS } from "@/components/GrassField/presets";
import styles from "./PresetSwitcher.module.css";

interface PresetSwitcherProps {
  active: string;
  onSelect: (key: string) => void;
}

/** Preset picker for the grass field. The presets themselves live with the
 *  component (GrassField/presets.ts) — this only renders them. */
export default function PresetSwitcher({ active, onSelect }: PresetSwitcherProps) {
  return (
    <div
      className={styles.container}
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
      <span className={styles.label}>Season</span>
      {Object.entries(GRASS_PRESETS).map(([key, preset]) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`${styles.btn} ${active === key ? styles.active : ""}`}
          title={`${preset.label} preset`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
