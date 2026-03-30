import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ship, Mail, Lock, User, ChevronRight, Truck, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/context/AppContext';
import { loginUser, registerUser } from '@/services/api';
import GlassCard from '@/components/ios/GlassCard';
import GlassInput from '@/components/ios/GlassInput';
import GlassSegmented from '@/components/ios/GlassSegmented';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUser } = useApp();

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'CLIENT' | 'DRIVER'>('CLIENT');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimEmail = email.trim();
    const trimPassword = password.trim();

    if (!trimEmail || !trimPassword) {
      toast.error('Completa todos los campos');
      return;
    }
    if (trimPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      toast.error('Introduce tu nombre');
      return;
    }

    setIsLoading(true);
    try {
      if (mode === 'register') {
        const { token, user } = await registerUser(name.trim(), trimEmail, trimPassword, role);
        setUser(user.name, user.role as 'CLIENT' | 'DRIVER' | 'ADMIN', token);
        toast.success('Cuenta creada');
        navigate(user.role === 'ADMIN' ? '/admin' : user.role === 'CLIENT' ? '/client' : '/driver');
      } else {
        const { token, user } = await loginUser(trimEmail, trimPassword);
        const homeCoords = user.latitude && user.longitude
          ? { lat: user.latitude, lon: user.longitude }
          : null;
        setUser(user.name, user.role as 'CLIENT' | 'DRIVER' | 'ADMIN', token, homeCoords);
        toast.success(`Bienvenido, ${user.name}`);
        navigate(user.role === 'ADMIN' ? '/admin' : user.role === 'CLIENT' ? '/client' : '/driver');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error de autenticación';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-12 bg-gradient-to-b from-[#e8f4fd] via-[var(--ios-bg-primary)] to-[var(--ios-bg-primary)]">

      {/* Decorative blobs */}
      <div className="fixed top-[-100px] right-[-80px] w-[300px] h-[300px] rounded-full bg-[var(--ios-blue)] opacity-[0.06] blur-[80px] pointer-events-none" />
      <div className="fixed bottom-[-60px] left-[-60px] w-[250px] h-[250px] rounded-full bg-[#5AC8FA] opacity-[0.08] blur-[60px] pointer-events-none" />

      {/* Logo */}
      <div className="animate-slide-up text-center mb-8 relative z-10">
        <div className="w-[72px] h-[72px] rounded-[18px] bg-gradient-to-br from-[var(--ios-blue)] to-[#5AC8FA] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
          <Ship className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-[28px] font-bold tracking-tight">City2Cruise</h1>
        <p className="ios-subtitle mt-1">Shop & Drop Port Hub</p>
      </div>

      {/* Form */}
      <GlassCard variant="ultra" className="w-full max-w-[380px] relative z-10" padding="lg">
        {isDemoMode && (
          <GlassSegmented
            items={[
              { id: 'login', label: 'Iniciar sesión' },
              { id: 'register', label: 'Registrarse' },
            ]}
            active={mode}
            onChange={(id) => setMode(id as 'login' | 'register')}
            className="mb-6"
          />
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="animate-slide-down">
              <GlassInput
                label="Nombre completo"
                icon={<User className="w-5 h-5" />}
                placeholder="Tu nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <GlassInput
            label="Email"
            icon={<Mail className="w-5 h-5" />}
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <GlassInput
            label="Contraseña"
            icon={<Lock className="w-5 h-5" />}
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          {mode === 'register' && (
            <div className="animate-slide-down space-y-2">
              <label className="ios-caption font-medium pl-1">Tipo de cuenta</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'CLIENT' as const, label: 'Cliente', Icon: ShoppingBag },
                  { id: 'DRIVER' as const, label: 'Conductor', Icon: Truck },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRole(id)}
                    className={`
                      flex flex-col items-center gap-2 p-4 rounded-[16px] transition-all duration-200
                      ${role === id
                        ? 'glass-thick ring-2 ring-[var(--ios-blue)]/20 scale-[1.02]'
                        : 'glass hover:bg-white/60'
                      }
                    `}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${role === id ? 'bg-[var(--ios-blue)]/10' : 'bg-black/[0.04]'}`}>
                      <Icon className={`w-5 h-5 ${role === id ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-tertiary)]'}`} />
                    </div>
                    <span className={`text-[14px] font-semibold ${role === id ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-secondary)]'}`}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="submit" disabled={isLoading} className="ios-btn-primary ios-btn-lg mt-2">
            {isLoading ? (
              <span className="ios-spinner border-white/30 border-t-white" />
            ) : (
              <>
                {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
      </GlassCard>

      <p className="ios-caption mt-6 text-center relative z-10">
        REKER Tech Solutions S.L. — Puertos 4.0
      </p>
    </div>
  );
}
