interface Props {
  className?: string;
}

export function LayoutRightOff({ className }: Props) {
  return (
    <svg viewBox="0 0 20 16" className={className} fill="currentColor" stroke="currentColor">
      <rect x="0" y="0" width="20" height="16" rx="2" fillOpacity={0} strokeOpacity={0.3} strokeWidth="1" />
      <rect x="17" y="0" width="3" height="16" rx="1.5" fillOpacity={0.15} strokeOpacity={0} />
    </svg>
  );
}
