import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useTranslation } from 'react-i18next';
import { createPaymentIntent, confirmPayment } from '@/services/api';
import GlassCard from '@/components/ios/GlassCard';
import { CreditCard, ShieldCheck, Package, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAccessibility } from '@/hooks/useAccessibility';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY || '');

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
  const { t } = useTranslation();
  const { cls } = useAccessibility();

  const amountEuros = (amountCents / 100).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      // Confirm payment with Stripe Elements (auth-only, not captured yet)
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (stripeError) {
        setErrorMsg(stripeError.message ?? t('payment.error'));
        setIsProcessing(false);
        return;
      }

      // Notify backend that Stripe Elements confirmed authorization
      await confirmPayment(requestId, paymentIntentId);

      toast.success(t('payment.success'));
      onSuccess();
    } catch {
      setErrorMsg(t('payment.error'));
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`${cls.section}`}>
      {/* Order summary */}
      <div className="bg-black/[0.03] rounded-[14px] p-4 border border-black/[0.06]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-[10px] bg-[var(--ios-blue)]/10 flex items-center justify-center">
            <Package className="w-4 h-4 text-[var(--ios-blue)]" aria-hidden="true" />
          </div>
          <div>
            <p className={`font-semibold text-[var(--ios-text-primary)] ${cls.label}`}>
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
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--ios-green)] flex-shrink-0" aria-hidden="true" />
          <span>Se captura solo tras la confirmación de entrega</span>
        </div>
      </div>

      {/* Stripe Elements Payment Form */}
      <div className="rounded-[14px] overflow-hidden border border-black/[0.06] bg-white/80 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-[var(--ios-text-secondary)]" aria-hidden="true" />
          <p className={`font-medium text-[var(--ios-text-secondary)] ${cls.label}`}>
            {t('payment.cardNumber')}
          </p>
        </div>
        <PaymentElement
          options={{
            layout: 'tabs',
            wallets: { applePay: 'auto', googlePay: 'auto' },
          }}
        />
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="bg-[var(--ios-red)]/8 border border-[var(--ios-red)]/20 rounded-[12px] px-4 py-3"
        >
          <p className="text-[13px] text-[var(--ios-red)] font-medium">{errorMsg}</p>
        </div>
      )}

      {/* PCI compliance notice */}
      <div className="flex items-start gap-2 px-1">
        <Lock className="w-3.5 h-3.5 text-[var(--ios-text-tertiary)] flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[11px] text-[var(--ios-text-tertiary)] leading-relaxed">
          Pago gestionado de forma segura por Stripe. Los datos de tu tarjeta nunca tocan nuestros servidores (PCI-DSS).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          aria-label={t('common.cancel')}
          className={`flex-1 ios-btn-ghost bg-black/5 disabled:opacity-40 ${cls.btn}`}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          aria-label={isProcessing ? t('payment.processing') : t('payment.pay', { amount: `${amountEuros} €` })}
          aria-busy={isProcessing}
          className={`flex-[2] ios-btn-primary ios-btn-lg disabled:opacity-60 ${cls.btn}`}
        >
          {isProcessing ? (
            <span className="ios-spinner border-white/30 border-t-white" aria-hidden="true" />
          ) : (
            t('payment.pay', { amount: `${amountEuros} €` })
          )}
        </button>
      </div>
    </form>
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
  const { t } = useTranslation();
  const { cls } = useAccessibility();

  useEffect(() => {
    setIsLoading(true);
    setLoadError('');

    createPaymentIntent(requestId, packageSize)
      .then(({ clientSecret: secret, paymentId, amountCents: cents }) => {
        setClientSecret(secret);
        setPaymentIntentId(`pi_${paymentId}`); // backend returns DB id; intent id in secret prefix
        setAmountCents(cents);
        // Extract real intent ID from client secret (format: pi_xxx_secret_yyy)
        const intentId = secret.split('_secret_')[0];
        setPaymentIntentId(intentId);
      })
      .catch(() => {
        setLoadError('No se pudo iniciar el pago. Inténtalo de nuevo.');
      })
      .finally(() => setIsLoading(false));
  }, [requestId, packageSize]);

  if (isLoading) {
    return (
      <GlassCard variant="ultra" className="py-10">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <span className="ios-spinner w-8 h-8 border-black/10 border-t-[var(--ios-blue)]" aria-hidden="true" />
          <p className="ios-caption">{t('common.loading')}</p>
        </div>
      </GlassCard>
    );
  }

  if (loadError) {
    return (
      <GlassCard variant="ultra">
        <p role="alert" className="text-[var(--ios-red)] text-center text-[14px] mb-4">{loadError}</p>
        <button onClick={onCancel} className={`ios-btn-ghost w-full ${cls.btn}`}>
          {t('common.back')}
        </button>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="ultra" delay={1}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[var(--ios-blue)]/10 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-[var(--ios-blue)]" aria-hidden="true" />
        </div>
        <div>
          <h2 className={`ios-title ${cls.text}`}>{t('payment.title')}</h2>
          <p className="ios-caption">{t('payment.cardNumber')}</p>
        </div>
      </div>

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
    </GlassCard>
  );
}
