interface IOSStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const statusConfig: Record<string, { label: string; class: string; dot: string }> = {
  REQUESTED: { label: 'Solicitado', class: 'ios-badge-orange', dot: 'bg-[var(--ios-orange)]' },
  ACCEPTED: { label: 'Aceptado', class: 'ios-badge-blue', dot: 'bg-[var(--ios-blue)]' },
  CONFIRMATION_PENDING: { label: 'Encuentro', class: 'ios-badge-purple', dot: 'bg-[var(--ios-purple)]' },
  IN_PROGRESS: { label: 'En traslado', class: 'ios-badge-blue', dot: 'bg-[var(--ios-blue)]' },
  DEPOSITED: { label: 'Depositado', class: 'ios-badge-green', dot: 'bg-[var(--ios-green)]' },
  PICKED_UP: { label: 'Recogido', class: 'ios-badge-green', dot: 'bg-[var(--ios-green)]' },
};

export default function IOSStatusBadge({ status, size = 'md' }: IOSStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, class: 'ios-badge-gray', dot: 'bg-gray-400' };

  return (
    <span className={`
      ios-badge ${config.class}
      ${size === 'sm' ? 'text-[11px] px-2 py-0.5' : ''}
    `}>
      <span className={`ios-dot ${config.dot} mr-1.5 ${['REQUESTED', 'CONFIRMATION_PENDING', 'IN_PROGRESS'].includes(status) ? 'ios-dot-pulse' : ''}`} />
      {config.label}
    </span>
  );
}
