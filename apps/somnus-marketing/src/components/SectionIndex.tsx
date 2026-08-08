import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import LineSidebar from "./LineSidebar";

export interface SectionIndexItem {
  id: string;
  label: string;
}

interface SectionIndexProps {
  ariaLabel: string;
  items: SectionIndexItem[];
}

const getActiveSectionIndex = (items: SectionIndexItem[]) => {
  const viewportAnchor = window.innerHeight * 0.44;
  let nextActiveIndex = 0;

  for (const [index, item] of items.entries()) {
    const section = document.getElementById(item.id);
    if (section && section.getBoundingClientRect().top <= viewportAnchor) {
      nextActiveIndex = index;
    }
  }

  return nextActiveIndex;
};

export const SectionIndex = ({ ariaLabel, items }: SectionIndexProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    let frameId: number | undefined;

    const updateActiveSection = () => {
      frameId = undefined;
      setActiveIndex(getActiveSectionIndex(items));
    };

    const requestUpdate = () => {
      if (frameId === undefined) {
        frameId = window.requestAnimationFrame(updateActiveSection);
      }
    };

    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [items]);

  const scrollToSection = (index: number) => {
    const section = document.getElementById(items[index]?.id ?? "");
    if (!section) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActiveIndex(index);
    section.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const sidebar = (
    <aside className="section-index">
      <LineSidebar
        accentColor="#437ef7"
        activeIndex={activeIndex}
        ariaLabel={ariaLabel}
        falloff="smooth"
        fontSize={0.78}
        itemGap={15}
        items={items.map((item) => item.label)}
        markerColor="#64748b"
        maxShift={15}
        onItemClick={scrollToSection}
        proximityRadius={72}
        showIndex
        showMarker={false}
        smoothing={180}
        textColor="#e2e8f0"
      />
    </aside>
  );

  return isMounted ? createPortal(sidebar, document.body) : null;
};
