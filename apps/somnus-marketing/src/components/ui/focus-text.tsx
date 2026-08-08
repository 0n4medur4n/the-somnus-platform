"use client";

import type { ReactNode } from "react";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "../../lib/utils";

type FocusTextProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div" | "blockquote" | "li";
  delay?: number;
};

export function FocusText({
  children,
  className,
  id,
  as: Tag = "p",
  delay = 0,
}: FocusTextProps) {
  const shouldReduceMotion = useReducedMotion();

  const MotionTag = motion.create(Tag);

  return (
    <MotionTag
      className={cn(className)}
      id={id}
      initial={{ filter: "blur(12px)", opacity: 0 }}
      whileInView={{
        filter: shouldReduceMotion ? "blur(0px)" : "blur(0px)",
        opacity: 1,
      }}
      viewport={{ once: false, amount: 0.3 }}
      transition={{
        duration: 1,
        delay,
        ease: [0.55, 0.085, 0.68, 0.53],
      }}
    >
      {children}
    </MotionTag>
  );
}
