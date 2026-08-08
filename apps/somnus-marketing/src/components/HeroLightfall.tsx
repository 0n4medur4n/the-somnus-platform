"use client";

import { useEffect, useState } from "react";

import Lightfall from "./Lightfall";

const getReducedMotionPreference = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function HeroLightfall() {
  const [paused, setPaused] = useState(getReducedMotionPreference);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPaused(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return (
    <Lightfall
      backgroundColor="#090d1a"
      backgroundGlow={0.7}
      colors={["#9FC0FF", "#437EF7", "#1746A2"]}
      density={0.3}
      glow={1}
      mouseInteraction
      mouseRadius={0.8}
      mouseStrength={0.3}
      opacity={1}
      paused={paused}
      speed={0.5}
      streakCount={2}
      streakLength={1}
      streakWidth={0.2}
      twinkle={1}
      zoom={3}
    />
  );
}
