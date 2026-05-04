import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ManualInterventionPanel } from '@/components/twin/ManualInterventionPanel';

const interveneCancel = vi.fn();
const interveneForceAssign = vi.fn();

vi.mock('@/services/twin', () => ({
  interveneCancel: (...args: unknown[]) => interveneCancel(...args),
  interveneForceAssign: (...args: unknown[]) => interveneForceAssign(...args),
}));

describe('ManualInterventionPanel', () => {
  beforeEach(() => {
    interveneCancel.mockReset();
    interveneForceAssign.mockReset();
  });

  it('calls interveneCancel for the selected request', async () => {
    interveneCancel.mockResolvedValue(undefined);
    render(<ManualInterventionPanel requestId={42} />);

    fireEvent.click(screen.getByRole('button', { name: /cancelar solicitud/i }));

    await waitFor(() => {
      expect(interveneCancel).toHaveBeenCalledWith(42, 'operator override');
    });
    expect(screen.getByRole('status')).toHaveTextContent(/cancelada manualmente/i);
  });

  it('calls interveneForceAssign with numeric driver id', async () => {
    interveneForceAssign.mockResolvedValue(undefined);
    render(<ManualInterventionPanel requestId={7} />);

    fireEvent.change(screen.getByPlaceholderText(/id conductor/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /forzar asignacion de conductor/i }));

    await waitFor(() => {
      expect(interveneForceAssign).toHaveBeenCalledWith(7, 99);
    });
  });
});
