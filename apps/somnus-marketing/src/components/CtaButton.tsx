import { NeumorphButton } from "./ui/neumorph-button";

interface CtaButtonProps {
  href: string;
  label: string;
}

export default function CtaButton({ href, label }: CtaButtonProps) {
  return (
    <NeumorphButton
      className="flex items-center"
      containerClassName="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--somnus-color-primary)]"
      href={href}
    >
      {label}
    </NeumorphButton>
  );
}
