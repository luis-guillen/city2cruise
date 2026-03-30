import { useNavigate } from 'react-router-dom';
import { Ship } from 'lucide-react';
import GlassCard from '@/components/ios/GlassCard';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 bg-[var(--ios-bg-primary)]">
      <GlassCard variant="ultra" className="text-center max-w-[340px]">
        <div className="w-16 h-16 rounded-full bg-[var(--ios-blue)]/10 flex items-center justify-center mx-auto mb-4">
          <Ship className="w-8 h-8 text-[var(--ios-blue)]" />
        </div>
        <h1 className="text-[34px] font-bold mb-1">404</h1>
        <p className="ios-subtitle mb-6">Esta página no existe</p>
        <button onClick={() => navigate('/')} className="ios-btn-primary ios-btn-lg">
          Volver al inicio
        </button>
      </GlassCard>
    </div>
  );
}
