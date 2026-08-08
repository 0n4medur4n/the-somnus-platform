"use client";

import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type PropsWithChildren,
} from "react";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "../../lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

type HoverBorderGradientProps = PropsWithChildren<
  {
    containerClassName?: string;
    className?: string;
    duration?: number;
    clockwise?: boolean;
    href: string;
  } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">
>;

const movingMap: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  BOTTOM:
    "radial-gradient(20.7% 50% at 50% 100%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  RIGHT:
    "radial-gradient(16.2% 41.199999999999996% at 100% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
};

const highlight =
  "radial-gradient(75% 181.15942028985506% at 50% 50%, var(--somnus-color-primary) 0%, rgba(255, 255, 255, 0) 100%)";

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  duration = 1,
  clockwise = true,
  href,
  ...props
}: HoverBorderGradientProps) {
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

  return (
    <a
      className={cn(
        "relative flex h-min w-fit flex-none flex-col flex-nowrap content-center items-center justify-center gap-10 overflow-visible rounded-full border bg-black/20 p-px decoration-clone transition duration-500 hover:bg-black/10",
        containerClassName,
      )}
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      <div
        className={cn(
          "z-10 w-auto rounded-[inherit] bg-black px-4 py-2 text-white",
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
        transition={{ ease: "linear", duration: shouldReduceMotion ? 0 : duration }}
      />
      <div className="absolute inset-[2px] z-1 flex-none rounded-[100px] bg-black" />
    </a>
  );
}
