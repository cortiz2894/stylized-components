"use client";

import { useRef } from "react";
import styles from "../landing.module.css";
import PlaygroundCanvas from "@/components/playground/PlaygroundCanvas";

export default function WaterPage() {
  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={pageRef} className={styles.page}>
      <PlaygroundCanvas />
    </div>
  );
}
