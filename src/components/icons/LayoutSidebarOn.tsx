interface Props {
  className?: string;
}

export function LayoutSidebarOn({ className }: Props) {
  return (
    <svg viewBox="0 0 20 16" className={className} fill="currentColor" stroke="currentColor">
      <rect x="0" y="0" width="5" height="16" rx="2" fillOpacity={0.7} strokeOpacity={0} />
      <line x1="5.5" y1="0" x2="5.5" y2="16" strokeOpacity={0.25} strokeWidth="1" />
      <rect x="7" y="0" width="13" height="16" rx="2" fillOpacity={0} strokeOpacity={0.45} strokeWidth="1" />
    </svg>
  );
}
