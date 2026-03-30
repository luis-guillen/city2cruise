import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '@/components/StatusBadge';
import type { PickupRequest } from '@/services/api';

type Status = PickupRequest['status'];

const statusLabels: Record<Status, string> = {
  REQUESTED: 'Solicitado',
  ACCEPTED: 'Aceptado',
  CONFIRMATION_PENDING: 'En encuentro',
  IN_PROGRESS: 'En traslado',
  DEPOSITED: 'Depositado',
  PICKED_UP: 'Recogido',
};

describe('StatusBadge', () => {
  it.each(Object.entries(statusLabels) as [Status, string][])(
    'renders label "%s" for status %s',
    (status, label) => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeDefined();
    }
  );

  it('REQUESTED has status-requested class', () => {
    const { container } = render(<StatusBadge status="REQUESTED" />);
    expect(container.firstChild).toHaveClass('bg-status-requested');
  });

  it('CONFIRMATION_PENDING has amber class', () => {
    const { container } = render(<StatusBadge status="CONFIRMATION_PENDING" />);
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });

  it('IN_PROGRESS has blue class', () => {
    const { container } = render(<StatusBadge status="IN_PROGRESS" />);
    expect(container.firstChild).toHaveClass('bg-blue-100');
  });

  it('DEPOSITED has status-deposited class', () => {
    const { container } = render(<StatusBadge status="DEPOSITED" />);
    expect(container.firstChild).toHaveClass('bg-status-deposited');
  });

  it('PICKED_UP has status-picked-up class', () => {
    const { container } = render(<StatusBadge status="PICKED_UP" />);
    expect(container.firstChild).toHaveClass('bg-status-picked-up');
  });

  it('each status renders a different className', () => {
    const statuses: Status[] = ['REQUESTED', 'CONFIRMATION_PENDING', 'IN_PROGRESS', 'DEPOSITED', 'PICKED_UP'];
    const classes = statuses.map((status) => {
      const { container } = render(<StatusBadge status={status} />);
      return (container.firstChild as HTMLElement).className;
    });
    const unique = new Set(classes);
    expect(unique.size).toBe(statuses.length);
  });
});
