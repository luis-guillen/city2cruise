import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { createPaymentIntent, confirmPayment } from '@/services/api';
import GlassCard from '@/components/ios/GlassCard';
import { CreditCard, ShieldCheck, Package, Lock, Sparkles, Rocket } from 'lucide-react';
import { toast } from 'sonner';

const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || '';
const stripePromise = isDemoMode || !stripePublicKey ? null : loadStripe(stripePublicKey);

const PACKAGE_LABELS: Record<string, string> = {
  SMALL: 'Pequeño',
  MEDIUM: 'Mediano',
  LARGE: 'Grande',
};

const PACKAGE_PRICES: Record<string, number> = {
  SMALL: 500,
  MEDIUM: 800,
  LARGE: 1200,
};

// ── Appearance for Stripe Elements (matches iOS glass aesthetic) ─────────────
const stripeAppearance = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#007AFF',
    colorBackground: 'rgba(255, 255, 255, 0.85)',
    colorText: '#1C1C1E',
    colorDanger: '#FF3B30',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
    spacingUnit: '4px',
    borderRadius: '14px',
    fontSizeSm: '14px',
  },
  rules: {
    '.Input': {
      border: '0.5px solid rgba(0,0,0,0.12)',
      boxShadow: 'none',
      padding: '14px 16px',
      backgroundColor: 'rgba(118,118,128,0.08)',
    },
    '.Input:focus': {
      border: '1.5px solid #007AFF',
      boxShadow: '0 0 0 4px rgba(0,122,255,0.12)',
    },
    '.Label': {
      fontWeight: '500',
      color: '#3C3C43',
    },
  },
};

// ── Inner form — has access to Stripe hooks ──────────────────────────────────
interface CheckoutFormProps {
  requestId: number;
  packageSize: string;
  amountCents: number;
  paymentIntentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function CheckoutForm({ requestId, packageSize, amountCents, paymentIntentId, onSuccess, onCancel }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const amountEuros = (amountCents / 100).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (stripeError) {
        setErrorMsg(stripeError.message ?? 'Error al procesar el pago');
        setIsProcessing(false);
        return;
      }

      await confirmPayment(requestId, paymentIntentId);

      toast.success('Pago completado');
      onSuccess();
    } catch {
      setErrorMsg('Error al procesar el pago');
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Order summary */}
      <div className="bg-black/[0.03] rounded-[14px] p-4 border border-black/[0.06]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-[10px] bg-[var(--ios-blue)]/10 flex items-center justify-center">
            <Package className="w-4 h-4 text-[var(--ios-blue)]" />
          </div>
          <div>
            <p className="font-semibold text-[var(--ios-text-primary)]">
              {PACKAGE_LABELS[packageSize] || packageSize}
            </p>
            <p className="text-[12px] text-[var(--ios-text-secondary)]">City2Cruise Shop&amp;Drop</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[18px] font-bold text-[var(--ios-blue)]">{amountEuros} €</p>
            <p className="text-[11px] text-[var(--ios-text-tertiary)]">IVA incluido</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[var(--ios-text-tertiary)]">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--ios-green)] flex-shrink-0" />
          <span>Se captura solo tras la confirmación de entrega</span>
        </div>
      </div>

      {/* Stripe Elements Payment Form */}
      <div className="rounded-[14px] overflow-hidden border border-black/[0.06] bg-white/80 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-[var(--ios-text-secondary)]" />
          <p className="font-medium text-[var(--ios-text-secondary)]">Datos de tarjeta</p>
        </div>
        <PaymentElement
          options={{
            layout: 'tabs',
            wallets: { applePay: 'auto', googlePay: 'auto' },
          }}
        />
      </div>

      {errorMsg && (
        <div className="bg-[var(--ios-red)]/8 border border-[var(--ios-red)]/20 rounded-[12px] px-4 py-3">
          <p className="text-[13px] text-[var(--ios-red)] font-medium">{errorMsg}</p>
        </div>
      )}

      {/* PCI compliance notice */}
      <div className="flex items-start gap-2 px-1">
        <Lock className="w-3.5 h-3.5 text-[var(--ios-text-tertiary)] flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-[var(--ios-text-tertiary)] leading-relaxed">
          Pago gestionado de forma segura por Stripe. Los datos de tu tarjeta nunca tocan nuestros servidores (PCI-DSS).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1 ios-btn-ghost bg-black/5 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-[2] ios-btn-primary ios-btn-lg disabled:opacity-60"
        >
          {isProcessing ? (
            <span className="ios-spinner border-white/30 border-t-white" />
          ) : (
            `Pagar ${amountEuros} €`
          )}
        </button>
      </div>
    </form>
  );
}

interface DemoCheckoutProps {
  requestId: number;
  packageSize: string;
  amountCents: number;
  paymentIntentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function DemoCheckoutForm({ requestId, packageSize, amountCents, paymentIntentId, onSuccess, onCancel }: DemoCheckoutProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const amountEuros = (amountCents / 100).toFixed(2);

  const handleDemoPayment = async () => {
    setIsProcessing(true);
    setErrorMsg('');
    try {
      await confirmPayment(requestId, paymentIntentId);
      toast.success('Pago demo completado');
      onSuccess();
    } catch {
      setErrorMsg('No se pudo completar el pago demo');
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-[var(--ios-blue)]/15 bg-[var(--ios-blue)]/6 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-[var(--ios-blue)]" />
          <p className="text-[13px] font-semibold text-[var(--ios-blue)] uppercase tracking-wide">Modo demo</p>
        </div>
        <p className="text-[13px] text-[var(--ios-text-secondary)] leading-relaxed">
          Este pago no usa Stripe real. Sirve para demostración y deja la solicitud lista para continuar el flujo.
        </p>
      </div>

      <div className="bg-black/[0.03] rounded-[14px] p-4 border border-black/[0.06]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-[10px] bg-[var(--ios-blue)]/10 flex items-center justify-center">
            <Package className="w-4 h-4 text-[var(--ios-blue)]" />
          </div>
          <div>
            <p className="font-semibold text-[var(--ios-text-primary)]">
              {PACKAGE_LABELS[packageSize] || packageSize}
            </p>
            <p className="text-[12px] text-[var(--ios-text-secondary)]">City2Cruise Demo Checkout</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[18px] font-bold text-[var(--ios-blue)]">{amountEuros} €</p>
            <p className="text-[11px] text-[var(--ios-text-tertiary)]">Simulación</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[var(--ios-text-tertiary)]">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--ios-green)] flex-shrink-0" />
          <span>La operación se marca como autorizada al pulsar “Simular pago”</span>
        </div>
      </div>

      <div className="rounded-[14px] overflow-hidden border border-black/[0.06] bg-white/80 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="w-4 h-4 text-[var(--ios-text-secondary)]" />
          <p className="font-medium text-[var(--ios-text-secondary)]">Demo activa</p>
        </div>
        <div className="rounded-[12px] border border-dashed border-black/10 bg-black/[0.02] px-4 py-5 text-center">
          <p className="text-[13px] text-[var(--ios-text-secondary)] mb-1">No se envían datos de tarjeta</p>
          <p className="text-[12px] text-[var(--ios-text-tertiary)]">PaymentIntent: {paymentIntentId}</p>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[var(--ios-red)]/8 border border-[var(--ios-red)]/20 rounded-[12px] px-4 py-3">
          <p className="text-[13px] text-[var(--ios-red)] font-medium">{errorMsg}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1 ios-btn-ghost bg-black/5 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleDemoPayment}
          disabled={isProcessing}
          className="flex-[2] ios-btn-primary ios-btn-lg disabled:opacity-60"
        >
          {isProcessing ? (
            <span className="ios-spinner border-white/30 border-t-white" />
          ) : (
            'Simular pago'
          )}
        </button>
      </div>
    </div>
  );
}

// ── Public component — loads intent and wraps Elements ───────────────────────
interface StripeCheckoutProps {
  requestId: number;
  packageSize: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function StripeCheckout({ requestId, packageSize, onSuccess, onCancel }: StripeCheckoutProps) {
  const [clientSecret, setClientSecret] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [amountCents, setAmountCents] = useState(PACKAGE_PRICES[packageSize] ?? 500);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [demoCheckout, setDemoCheckout] = useState(isDemoMode);

  useEffect(() => {
    setIsLoading(true);
    setLoadError('');

    createPaymentIntent(requestId, packageSize)
      .then(({ clientSecret: secret, paymentId, amountCents: cents, demoMode, paymentIntentId: intentId }) => {
        setClientSecret(secret);
        setDemoCheckout(demoMode || isDemoMode);
        setPaymentIntentId(intentId || `pi_${paymentId}`);
        setAmountCents(cents);
      })
      .catch(() => {
        setLoadError('No se pudo iniciar el pago. Inténtalo de nuevo.');
      })
      .finally(() => setIsLoading(false));
  }, [requestId, packageSize]);

  if (isLoading) {
    return (
      <GlassCard variant="ultra" className="py-10">
        <div className="flex flex-col items-center gap-3">
          <span className="ios-spinner w-8 h-8 border-black/10 border-t-[var(--ios-blue)]" />
          <p className="ios-caption">Cargando...</p>
        </div>
      </GlassCard>
    );
  }

  if (loadError) {
    return (
      <GlassCard variant="ultra">
        <p className="text-[var(--ios-red)] text-center text-[14px] mb-4">{loadError}</p>
        <button onClick={onCancel} className="ios-btn-ghost w-full">
          Volver
        </button>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="ultra" delay={1}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[var(--ios-blue)]/10 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-[var(--ios-blue)]" />
        </div>
        <div>
          <h2 className="ios-title">Pago seguro</h2>
          <p className="ios-caption">{demoCheckout ? 'Modo demo sin tarjeta real' : 'Datos de tarjeta'}</p>
        </div>
      </div>

      {demoCheckout || !stripePromise ? (
        <DemoCheckoutForm
          requestId={requestId}
          packageSize={packageSize}
          amountCents={amountCents}
          paymentIntentId={paymentIntentId}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      ) : (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: stripeAppearance }}
        >
          <CheckoutForm
            requestId={requestId}
            packageSize={packageSize}
            amountCents={amountCents}
            paymentIntentId={paymentIntentId}
            onSuccess={onSuccess}
            onCancel={onCancel}
          />
        </Elements>
      )}
    </GlassCard>
  );
}
