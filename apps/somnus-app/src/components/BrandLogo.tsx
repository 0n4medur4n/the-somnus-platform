import { useTranslation } from "react-i18next";
import morpheoWordmark from "../assets/brand/morpheo-wordmark.png";
import somnusWordmark from "../assets/brand/somnus-wordmark.png";

/**
 * The brand wordmarks, cropped from the marketing site's transparent logos.
 * The owl is a cut-out, so it takes the page background in every theme.
 * The image is the name: its alt text is the brand, never left empty.
 */
const WORDMARKS = {
  somnus: { src: somnusWordmark, width: 720, height: 82, altKey: "common.appName" },
  morpheo: { src: morpheoWordmark, width: 720, height: 108, altKey: "common.productName" },
} as const;

export type Brand = keyof typeof WORDMARKS;

export function BrandLogo({ brand, className }: { brand: Brand; className?: string }) {
  const { t } = useTranslation();
  const mark = WORDMARKS[brand];
  return (
    <img
      src={mark.src}
      width={mark.width}
      height={mark.height}
      alt={t(mark.altKey)}
      className={className ?? "h-5 w-auto"}
    />
  );
}
