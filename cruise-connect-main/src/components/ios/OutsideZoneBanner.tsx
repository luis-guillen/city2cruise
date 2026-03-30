import { MapPinOff, ShieldAlert } from 'lucide-react';
import { SERVICE_AREA } from '@/utils/geofence';

interface OutsideZoneBannerProps {
  /** Si true, bloquea toda la UI con overlay */
  blocking?: boolean;
}

export default function OutsideZoneBanner({ blocking = true }: OutsideZoneBannerProps) {
  if (blocking) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-[var(--ios-bg-primary)]">
        {/* Blob decorativo */}
        <div className="absolute top-[10%] right-[-40px] w-[250px] h-[250px] rounded-full bg-[var(--ios-red)] opacity-[0.06] blur-[80px] pointer-events-none" />
        <div className="absolute bottom-[20%] left-[-40px] w-[200px] h-[200px] rounded-full bg-[var(--ios-orange)] opacity-[0.08] blur-[60px] pointer-events-none" />

        <div className="glass-ultra rounded-[24px] p-8 max-w-[380px] text-center animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-[var(--ios-red)]/10 flex items-center justify-center mx-auto mb-5">
            <MapPinOff className="w-8 h-8 text-[var(--ios-red)]" />
          </div>

          <h1 className="text-[22px] font-bold tracking-tight mb-2">
            Fuera de zona operativa
          </h1>

          <p className="text-[15px] text-[var(--ios-text-secondary)] leading-relaxed mb-4">
            City2Cruise solo está disponible en la zona de <strong>{SERVICE_AREA.name}</strong>.
            Tu ubicación actual se encuentra fuera del área de servicio.
          </p>

          <div className="glass rounded-[14px] p-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--ios-orange)]/10 flex items-center justify-center flex-shrink-0">
                <ShieldAlert className="w-4.5 h-4.5 text-[var(--ios-orange)]" />
              </div>
              <div className="text-left">
                <p className="text-[13px] font-semibold">Zona operativa</p>
                <p className="text-[12px] text-[var(--ios-text-tertiary)]">
                  Puerto de La Luz y {SERVICE_AREA.name}
                </p>
              </div>
            </div>
          </div>

          <p className="text-[13px] text-[var(--ios-text-tertiary)]">
            Acércate a la zona del puerto para usar la app. Si crees que esto es un error,
            activa la ubicación en tu dispositivo.
          </p>
        </div>
      </div>
    );
  }

  // Versión no-bloqueante (banner inline)
  return (
    <div className="glass rounded-[16px] p-4 flex items-center gap-3 border-l-4 border-[var(--ios-red)] animate-slide-up">
      <div className="w-10 h-10 rounded-xl bg-[var(--ios-red)]/10 flex items-center justify-center flex-shrink-0">
        <MapPinOff className="w-5 h-5 text-[var(--ios-red)]" />
      </div>
      <div>
        <p className="text-[14px] font-semibold">Fuera de zona operativa</p>
        <p className="text-[12px] text-[var(--ios-text-secondary)]">
          City2Cruise solo funciona en {SERVICE_AREA.name}
        </p>
      </div>
    </div>
  );
}
