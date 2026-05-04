import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
  confirmPayment: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  createPaymentIntent: mocks.createPaymentIntent,
  confirmPayment: mocks.confirmPayment,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

describe('StripeCheckout demo mode', () => {
  let StripeCheckout: typeof import('@/components/StripeCheckout').default;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubEnv('VITE_STRIPE_PUBLIC_KEY', '');
    mocks.createPaymentIntent.mockResolvedValue({
      clientSecret: 'demo_demo_pi_123_secret_demo',
      paymentId: 42,
      amountCents: 500,
      demoMode: true,
      paymentIntentId: 'demo_pi_123',
    });
    mocks.confirmPayment.mockResolvedValue({ status: 'AUTHORIZED' });
    StripeCheckout = (await import('@/components/StripeCheckout')).default;
  });

  it('muestra el checkout demo y completa el pago sin Stripe real', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    render(
      <StripeCheckout
        requestId={6}
        packageSize="SMALL"
        onSuccess={onSuccess}
        onCancel={onCancel}
      />,
    );

    expect(await screen.findByText('Demo activa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simular pago/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Simular pago/i }));

    await waitFor(() => {
      expect(mocks.confirmPayment).toHaveBeenCalledWith(6, 'demo_pi_123');
      expect(onSuccess).toHaveBeenCalled();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Pago demo completado');
  });
});
