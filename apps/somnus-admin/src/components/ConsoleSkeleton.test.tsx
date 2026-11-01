import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleSkeleton } from "./ConsoleSkeleton.js";
import { DriveSkeleton } from "./DriveSkeleton.js";
import { ChartSkeleton, LoadingRegion, Skeleton, SkeletonLines } from "./ui/Skeleton.js";

/** Every drawn block, wherever it sits, must be invisible to assistive technology. */
function blocksOutsideHiddenParents(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(".somnus-skeleton")].filter(
    (block) =>
      block.getAttribute("aria-hidden") !== "true" && !block.closest("[aria-hidden='true']"),
  );
}

describe.each([
  ["console", ConsoleSkeleton],
  ["Drive", DriveSkeleton],
])("the %s skeleton", (_name, Page) => {
  it("is the page: one main, one heading, one announced status", () => {
    render(<Page message="Cargando…" />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Cargando…" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("draws the layout it stands in for, with the real wordmark", () => {
    const { container } = render(<Page message="Cargando…" />);
    expect(container.querySelectorAll(".somnus-skeleton").length).toBeGreaterThan(10);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("keeps every placeholder out of the accessibility tree", () => {
    const { container } = render(<Page message="Cargando…" />);
    expect(blocksOutsideHiddenParents(container)).toEqual([]);
    // Nothing focusable in a page that is only a drawing.
    expect(container.querySelectorAll("a, button, input, select, textarea")).toHaveLength(0);
  });
});

describe("the console's skeleton pieces", () => {
  it("a loading region announces once, and its shapes stay hidden", () => {
    const { container } = render(
      <LoadingRegion message="Cargando datos">
        <Skeleton className="h-4 w-10" />
        <SkeletonLines lines={3} />
        <ChartSkeleton />
      </LoadingRegion>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Cargando datos");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(blocksOutsideHiddenParents(container)).toEqual([]);
  });

  it("a text skeleton ends in a shorter line", () => {
    const { container } = render(<SkeletonLines lines={3} />);
    const bars = container.querySelectorAll(".somnus-skeleton");
    expect(bars).toHaveLength(3);
    expect(bars[2]).toHaveClass("w-2/3");
    expect(bars[0]).toHaveClass("w-full");
  });
});
