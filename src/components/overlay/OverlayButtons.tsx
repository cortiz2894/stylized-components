"use client";

import { useRef } from "react";
import { COLORS } from "@/components/shared/theme";
import styles from "./OverlayButtons.module.css";

interface OverlayButtonsProps {
  hideLeva: boolean;
  onToggleLeva: () => void;
  /** Grid toggle is rendered only when a handler is provided. */
  showGrid?: boolean;
  onToggleGrid?: () => void;
  /** GLB import controls are rendered only when a handler is provided. */
  hasGlb?: boolean;
  onLoadGlb?: (file: File) => void;
  onClearGlb?: () => void;
  /** Immersive toggle is rendered only when a handler is provided. While
   *  immersive, this is the ONLY button left — it has to be, or there'd be no way
   *  back out other than the Escape key. */
  immersive?: boolean;
  onToggleImmersive?: () => void;
}

export default function OverlayButtons({
  showGrid,
  onToggleGrid,
  hideLeva,
  onToggleLeva,
  hasGlb,
  onLoadGlb,
  onClearGlb,
  immersive,
  onToggleImmersive,
}: OverlayButtonsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadGlb?.(file);
    e.target.value = "";
  };

  const immersiveBtn = onToggleImmersive && (
    <button
      onClick={onToggleImmersive}
      className={`${styles.btn} ${immersive ? styles.active : ""}`}
      title={immersive ? "Exit immersive view (Esc)" : "Immersive view — hide all UI"}
    >
      {immersive ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />
        </svg>
      )}
    </button>
  );

  if (immersive) {
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
        {immersiveBtn}
      </div>
    );
  }

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
      {/* Load GLB */}
      {onLoadGlb && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            className={styles.fileInput}
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`${styles.importBtn} ${hasGlb ? styles.active : ""}`}
            title="Load GLB model"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M8 2v8M5 7l3 3 3-3" />
              <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
            </svg>
            <span className={styles.importLabel}>Import GLB</span>
          </button>
        </>
      )}

      {/* Clear GLB */}
      {hasGlb && onClearGlb && (
        <button
          onClick={onClearGlb}
          className={styles.btn}
          title="Remove model (back to sphere)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      )}

      {/* Toggle Grid */}
      {onToggleGrid && (
        <button
          onClick={onToggleGrid}
          className={`${styles.btn} ${showGrid ? styles.active : styles.inactive}`}
          title={showGrid ? "Hide Grid" : "Show Grid"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="1" width="6" height="6" />
            <rect x="9" y="1" width="6" height="6" />
            <rect x="1" y="9" width="6" height="6" />
            <rect x="9" y="9" width="6" height="6" />
          </svg>
        </button>
      )}

      {/* Toggle Leva Controls */}
      <button
        onClick={onToggleLeva}
        className={`${styles.btn} ${!hideLeva ? styles.active : styles.inactive}`}
        title={hideLeva ? "Show Controls" : "Hide Controls"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="2" y1="4" x2="14" y2="4" />
          <circle cx="10" cy="4" r="1.5" fill="currentColor" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <circle cx="5" cy="8" r="1.5" fill="currentColor" />
          <line x1="2" y1="12" x2="14" y2="12" />
          <circle cx="9" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>

      {/* Immersive view */}
      {immersiveBtn}
    </div>
  );
}
