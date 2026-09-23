interface Props {
  className?: string;
}

export function GripDots({ className }: Props) {
  return (
    <svg viewBox="0 0 4 12" width={4} height={12} className={className} aria-hidden>
      <circle cx="2" cy="2" r="1.15" fill="currentColor" />
      <circle cx="2" cy="6" r="1.15" fill="currentColor" />
      <circle cx="2" cy="10" r="1.15" fill="currentColor" />
    </svg>
  );
}
