"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { GabaMolecule } from "./GabaMolecule";
import {
  GABA_CONNECTION_STEPS,
  GABA_MEDIA_QUERIES,
  GABA_SIGNAL_SEQUENCE,
  GABA_TIMING,
} from "./gaba.constants";
import type { GabaHeroProps } from "./gaba.types";
import "./GabaHero.css";

export function GabaHero({ copy }: GabaHeroProps) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    let dispose: () => void = () => undefined;

    const initialise = async () => {
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);

      const media = gsap.matchMedia();
      media.add(GABA_MEDIA_QUERIES, (mediaContext) => {
        const conditions = mediaContext.conditions as { all: boolean; reduced: boolean };
        const animationContext = gsap.context(() => {
          const molecule = root.querySelector<HTMLElement>(".gaba-background__molecule");
          const signals = Array.from(root.querySelectorAll<SVGGElement>(".gaba-molecule__signal"));
          const signalRings = root.querySelectorAll(".signal-node__ring");
          const atomAssemblies = root.querySelectorAll(".atom__assembly");
          const atomDepths = root.querySelectorAll(".atom__depth");
          const atomGlows = root.querySelectorAll(".atom__glow");
          const specularHighlights = root.querySelectorAll(".atom__specular");
          const priorityGlows = root.querySelectorAll(".atom--n .atom__glow, .atom--o .atom__glow");
          const bondBases = root.querySelectorAll(".bond__base");
          const bondCores = root.querySelectorAll(".bond__core");
          const bondHighlights = root.querySelectorAll(".bond__highlight");
          const drawableBonds = root.querySelectorAll<SVGPathElement>(
            ".bond__base, .bond__core, .bond__highlight",
          );
          const ambientGlows = root.querySelectorAll(".gaba-molecule__ambient");
          const formula = root.querySelector(".gaba-molecule__formula");
          const hero = root.closest("main")?.querySelector<HTMLElement>(".story-hero") ?? null;

          if (!molecule || !formula) return;

          gsap.set(root.querySelectorAll(".atom, .atom__assembly, .atom__depth, .bond"), {
            autoAlpha: 1,
            clearProps: "transform",
          });
          gsap.set(drawableBonds, { strokeDashoffset: 0 });

          if (conditions.reduced) {
            gsap.fromTo(root, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
            gsap.set(molecule, {
              autoAlpha: 0.46,
              clearProps: "filter,transform",
            });
            gsap.set(atomAssemblies, {
              autoAlpha: 1,
              clearProps: "filter,transform",
            });
            gsap.set(specularHighlights, { autoAlpha: 1 });
            gsap.set(bondBases, {
              autoAlpha: 0.72,
              strokeDasharray: "none",
              strokeDashoffset: 0,
            });
            gsap.set(bondCores, {
              autoAlpha: 0.88,
              strokeDasharray: "none",
              strokeDashoffset: 0,
            });
            gsap.set(bondHighlights, {
              autoAlpha: 0.7,
              strokeDasharray: "10 18",
              strokeDashoffset: 0,
            });
            gsap.set(signals, { autoAlpha: 0.42 });
            return;
          }

          gsap.set(root, { autoAlpha: 0 });
          gsap.set(molecule, {
            autoAlpha: 0.04,
            filter: "blur(18px)",
            scale: 0.97,
            transformOrigin: "50% 50%",
          });
          gsap.set(atomAssemblies, {
            autoAlpha: 0.12,
            filter: "blur(7px)",
            scale: 0.68,
            transformOrigin: "50% 50%",
          });
          gsap.set(specularHighlights, { autoAlpha: 0 });

          const nitrogenAssembly = root.querySelector<SVGGElement>(
            "#atom-nitrogen .atom__assembly",
          );
          if (!nitrogenAssembly) return;

          gsap.set(nitrogenAssembly, {
            autoAlpha: 0.72,
            filter: "blur(5px)",
            scale: 0.84,
            x: -22,
            y: 30,
          });

          for (const step of GABA_CONNECTION_STEPS) {
            const assembly = root.querySelector<SVGGElement>(
              `#atom-${step.atomId} .atom__assembly`,
            );
            if (!assembly) continue;
            gsap.set(assembly, { x: step.fromX, y: step.fromY });
          }

          gsap.set(signals, { autoAlpha: 0, scale: 0.82, transformOrigin: "50% 50%" });
          gsap.set(formula, { autoAlpha: 0.28 });
          gsap.set(ambientGlows, { autoAlpha: 0.35, scale: 0.94, transformOrigin: "50% 50%" });
          for (const bondPath of drawableBonds) {
            const pathLength = bondPath.getTotalLength();
            gsap.set(bondPath, {
              strokeDasharray: pathLength,
              strokeDashoffset: pathLength,
            });
          }
          gsap.set(bondBases, { autoAlpha: 0 });
          gsap.set(bondCores, { autoAlpha: 0 });
          gsap.set(bondHighlights, { autoAlpha: 0 });
          gsap.set(atomGlows, { opacity: 0.09 });

          gsap.to(atomDepths, {
            duration: 2.8,
            ease: "sine.inOut",
            repeat: -1,
            scale: 1.025,
            stagger: 0.18,
            transformOrigin: "50% 50%",
            yoyo: true,
          });

          gsap.to(signalRings, {
            autoAlpha: 0.12,
            duration: 1.8,
            ease: "sine.inOut",
            repeat: -1,
            scale: 1.55,
            stagger: 0.22,
            transformOrigin: "50% 50%",
            yoyo: true,
          });

          gsap.to(ambientGlows, {
            autoAlpha: 0.7,
            duration: 3.6,
            ease: "sine.inOut",
            repeat: -1,
            scale: 1.08,
            stagger: 0.5,
            transformOrigin: "50% 50%",
            yoyo: true,
          });

          const masterTimeline = gsap
            .timeline({
              defaults: { ease: "none" },
              scrollTrigger: {
                end: "max",
                invalidateOnRefresh: true,
                scrub: 1.2,
                start: hero ? "bottom 75%" : "top bottom",
                trigger: hero ?? root,
              },
            })
            .addLabel("intro", GABA_TIMING.intro)
            .addLabel("signals", GABA_TIMING.signals)
            .addLabel("connection", GABA_TIMING.connection)
            .addLabel("structure", GABA_TIMING.structure)
            .addLabel("morpheo", GABA_TIMING.morpheo)
            .addLabel("conversion", GABA_TIMING.conversion)
            .to(root, { autoAlpha: 1, duration: 0.12, ease: "power2.out" }, "intro")
            .to(
              molecule,
              {
                autoAlpha: 0.32,
                duration: 0.34,
                ease: "power3.out",
                filter: "blur(0px)",
                scale: 1,
              },
              "intro+=0.02",
            )
            .to(
              nitrogenAssembly,
              {
                autoAlpha: 1,
                duration: 0.12,
                ease: "power2.out",
                filter: "blur(0px)",
                scale: 1,
                x: 0,
                y: 0,
              },
              "intro",
            )
            .to(
              formula,
              {
                autoAlpha: 0.62,
                duration: 0.12,
              },
              "signals",
            )
            .to(formula, { autoAlpha: 0.32, duration: 0.1 }, "connection");

          for (const signalStep of GABA_SIGNAL_SEQUENCE) {
            const signal = signals[signalStep.signalIndex];
            if (!signal) continue;

            masterTimeline
              .to(
                signal,
                {
                  autoAlpha: 0.9,
                  duration: signalStep.appearDuration,
                  ease: "power2.out",
                  scale: 1,
                },
                signalStep.start,
              )
              .to(
                signal,
                {
                  autoAlpha: 0,
                  duration: signalStep.fadeDuration,
                  ease: "power2.in",
                  scale: 1.08,
                },
                signalStep.fadeStart,
              );
          }

          const connectionDuration =
            (GABA_TIMING.structure - GABA_TIMING.connection) / GABA_CONNECTION_STEPS.length;

          GABA_CONNECTION_STEPS.forEach((step, index) => {
            const assembly = root.querySelector<SVGGElement>(
              `#atom-${step.atomId} .atom__assembly`,
            );
            const glow = assembly?.querySelector<SVGCircleElement>(".atom__glow") ?? null;
            const specular = root.querySelector<SVGEllipseElement>(
              `[data-specular="${step.atomId}"]`,
            );
            const bondGroups = step.bondIds
              .map((bondId) => root.querySelector<SVGGElement>(`#${bondId}`))
              .filter((bond): bond is SVGGElement => bond !== null);
            const stepBases = bondGroups
              .map((bond) => bond.querySelector<SVGPathElement>(".bond__base"))
              .filter((bond): bond is SVGPathElement => bond !== null);
            const stepCores = bondGroups
              .map((bond) => bond.querySelector<SVGPathElement>(".bond__core"))
              .filter((bond): bond is SVGPathElement => bond !== null);
            const stepHighlights = bondGroups
              .map((bond) => bond.querySelector<SVGPathElement>(".bond__highlight"))
              .filter((bond): bond is SVGPathElement => bond !== null);

            if (!assembly || !glow || !specular || bondGroups.length === 0) return;

            const stepStart = GABA_TIMING.connection + connectionDuration * index;
            const travelDuration = connectionDuration * 0.82;

            masterTimeline
              .to(
                stepBases,
                {
                  autoAlpha: 0.76,
                  duration: travelDuration,
                  ease: "power1.inOut",
                  strokeDashoffset: 0,
                },
                stepStart,
              )
              .to(
                stepCores,
                {
                  autoAlpha: 0.94,
                  duration: travelDuration,
                  ease: "power1.inOut",
                  strokeDashoffset: 0,
                },
                stepStart,
              )
              .to(
                stepHighlights,
                {
                  autoAlpha: 0.9,
                  duration: travelDuration,
                  ease: "power1.inOut",
                  strokeDashoffset: 0,
                },
                stepStart,
              )
              .to(
                assembly,
                {
                  autoAlpha: 1,
                  duration: travelDuration,
                  ease: "power1.inOut",
                  filter: "blur(0px)",
                  scale: 1,
                  x: 0,
                  y: 0,
                },
                stepStart,
              )
              .to(
                glow,
                {
                  duration: connectionDuration * 0.42,
                  ease: "power2.out",
                  opacity: 0.68,
                },
                stepStart + travelDuration * 0.58,
              )
              .to(
                glow,
                {
                  duration: connectionDuration * 0.35,
                  ease: "power2.inOut",
                  opacity: 0.2,
                },
                stepStart + travelDuration,
              )
              .to(
                specular,
                {
                  autoAlpha: 1,
                  duration: connectionDuration * 0.22,
                  ease: "power2.out",
                },
                stepStart + travelDuration,
              );
          });

          masterTimeline
            .set(bondHighlights, { strokeDasharray: "10 18", strokeDashoffset: 0 }, "structure")
            .to(
              bondHighlights,
              {
                duration: 0.11,
                ease: "none",
                stagger: 0.008,
                strokeDashoffset: -28,
              },
              "structure",
            )
            .to(
              ambientGlows,
              {
                autoAlpha: 0.92,
                duration: 0.18,
                scale: 1.06,
                stagger: 0.025,
              },
              "structure",
            )
            .to(molecule, { autoAlpha: 0.5, duration: 0.16 }, "structure")
            .to(molecule, { autoAlpha: 0.43, duration: 0.16, scale: 0.96 }, "morpheo")
            .to(formula, { autoAlpha: 0.84, duration: 0.12 }, "morpheo")
            .to(
              priorityGlows,
              {
                duration: 0.08,
                opacity: 0.62,
                stagger: 0.018,
              },
              "conversion",
            )
            .to(
              priorityGlows,
              {
                duration: 0.09,
                opacity: 0.22,
                stagger: 0.018,
              },
              "conversion+=0.09",
            )
            .to(
              molecule,
              {
                autoAlpha: 0.46,
                duration: 0.15,
                scale: 1,
              },
              "conversion",
            );
        }, root);

        return () => animationContext.revert();
      });

      ScrollTrigger.refresh();
      dispose = () => media.revert();
    };

    void initialise();

    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  return (
    <section aria-hidden="true" className="gaba-background" ref={rootRef}>
      <div className="gaba-background__wash" />
      <div className="gaba-background__molecule">
        <GabaMolecule
          moleculeDescription={copy.moleculeDescription}
          moleculeTitle={copy.moleculeTitle}
          signalLabels={copy.signalLabels}
        />
      </div>
    </section>
  );
}
