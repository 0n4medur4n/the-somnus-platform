import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/utils.js";
import { PageSkeleton } from "./PageSkeleton.js";
import { CardsSkeleton, LoadingRegion, Skeleton } from "./Skeleton.js";

/** Every drawn block, wherever it sits, must be invisible to assistive technology. */
function blocksOutsideHiddenParents(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(".somnus-skeleton")].filter(
    (block) =>
      block.getAttribute("aria-hidden") !== "true" && !block.closest("[aria-hidden='true']"),
  );
}

describe("skeleton screens", () => {
  it("the page skeleton is the page: one main, one heading, one status", () => {
    renderWithProviders(<PageSkeleton message="Cargando…" />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Cargando…" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("the page skeleton draws the shell the person is about to get", () => {
    const { container } = renderWithProviders(<PageSkeleton message="Cargando…" />);
    expect(container.querySelectorAll(".somnus-skeleton").length).toBeGreaterThan(8);
    // The brand mark is real, not a grey box: it is already there when the page fills in.
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("hides every placeholder block from assistive technology", () => {
    const { container } = renderWithProviders(
      <>
        <PageSkeleton message="Cargando…" />
        <CardsSkeleton message="Cargando tarjetas" title />
      </>,
    );
    expect(container.querySelectorAll(".somnus-skeleton").length).toBeGreaterThan(0);
    expect(blocksOutsideHiddenParents(container)).toEqual([]);
  });

  it("a loading region announces its message once and keeps the shapes out of the tree", () => {
    renderWithProviders(
      <LoadingRegion message="Cargando datos">
        <Skeleton className="h-4 w-10" />
      </LoadingRegion>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Cargando datos");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Cargando datos")).toHaveClass("sr-only");
  });

  it("the cards skeleton draws as many cards as asked, up to four", () => {
    const { container } = renderWithProviders(<CardsSkeleton message="Cargando" cards={2} />);
    expect(container.querySelectorAll(".rounded-2xl")).toHaveLength(2);
  });
});
