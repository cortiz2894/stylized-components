"use client";

import { useRef } from "react";
import styles from "../landing.module.css";
import GrassCanvas from "@/components/grass/GrassCanvas";

export default function GrassPage() {
  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={pageRef} className={styles.page}>
      <GrassCanvas />
    </div>
  );
}
