"use client";

import { useEffect, useState } from "react";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "../../lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

type NeumorphButtonProps = {
  children: React.ReactNode;
  containerClassName?: string;
  className?: string;
  duration?: number;
  clockwise?: boolean;
  href: string;
  target?: string;
  rel?: string;
};

const movingMap: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, var(--somnus-color-primary) 0%, rgba(67, 126, 247, 0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, var(--somnus-color-primary) 0%, rgba(67, 126, 247, 0) 100%)",
  BOTTOM:
    "radial-gradient(20.7% 50% at 50% 100%, var(--somnus-color-primary) 0%, rgba(67, 126, 247, 0) 100%)",
  RIGHT:
    "radial-gradient(16.2% 41.2% at 100% 50%, var(--somnus-color-primary) 0%, rgba(67, 126, 247, 0) 100%)",
};

const highlight =
  "radial-gradient(75% 181.16% at 50% 50%, var(--somnus-color-primary) 0%, rgba(67, 126, 247, 0) 100%)";

export function NeumorphButton({
  children,
  containerClassName,
  className,
  duration = 1,
  clockwise = true,
  href,
  target,
  rel,
}: NeumorphButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [direction, setDirection] = useState<Direction>("TOP");
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (hovered || shouldReduceMotion) {
      return undefined;
    }

    const directions: Direction[] = ["TOP", "LEFT", "BOTTOM", "RIGHT"];
    const interval = setInterval(() => {
      setDirection((currentDirection) => {
        const currentIndex = directions.indexOf(currentDirection);
        const nextIndex = clockwise
          ? (currentIndex - 1 + directions.length) % directions.length
          : (currentIndex + 1) % directions.length;

        return directions[nextIndex] ?? "TOP";
      });
    }, duration * 1000);

    return () => clearInterval(interval);
  }, [clockwise, duration, hovered, shouldReduceMotion]);

  const neumorphShadow = hovered
    ? "4px 4px 10px rgba(5, 8, 18, 0.7), -4px -4px 10px rgba(30, 42, 74, 0.4)"
    : "6px 6px 14px rgba(5, 8, 18, 0.8), -6px -6px 14px rgba(30, 42, 74, 0.5)";

  const neumorphShadowActive =
    "inset 3px 3px 8px rgba(5, 8, 18, 0.7), inset -3px -3px 8px rgba(30, 42, 74, 0.4)";

  return (
    <motion.a
      className={cn(
        "group relative flex h-min w-fit flex-none flex-col flex-nowrap content-center items-center justify-center gap-10 overflow-visible rounded-2xl border border-transparent bg-[var(--somnus-color-surface)] p-px transition-all duration-300",
        containerClassName,
      )}
      href={href}
      target={target}
      rel={rel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={{ boxShadow: neumorphShadow }}
      animate={{ boxShadow: neumorphShadow }}
      whileTap={{ boxShadow: shouldReduceMotion ? neumorphShadow : neumorphShadowActive }}
    >
      <div
        className={cn(
          "z-10 flex w-auto items-center justify-center rounded-[inherit] bg-[var(--somnus-color-surface)] px-8 py-3 text-sm font-semibold text-[var(--somnus-color-text)] transition-colors duration-300 group-hover:text-white",
          className,
        )}
      >
        {children}
      </div>
      <motion.div
        animate={{
          background:
            hovered && !shouldReduceMotion
              ? [movingMap[direction], highlight]
              : movingMap[direction],
        }}
        className="absolute inset-0 z-0 flex-none overflow-hidden rounded-[inherit]"
        initial={{ background: movingMap[direction] }}
        style={{ filter: "blur(2px)", height: "100%", width: "100%" }}
        transition={{
          ease: "linear",
          duration: shouldReduceMotion ? 0 : duration,
        }}
      />
      <div className="absolute inset-[2px] z-1 flex-none rounded-[calc(1rem-2px)] bg-[var(--somnus-color-surface)]" />
    </motion.a>
  );
}
