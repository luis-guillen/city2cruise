import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Hito 4.2.5 — Prompt de actualizacion del Service Worker.
 *
 * Cuando vite-plugin-pwa detecta que hay una version nueva del SW
 * en espera, dispara el evento global 'sw-update-available'
 * (lo lanzamos nosotros en main.tsx). Mostramos un toast bottom-center
 * con boton "Actualizar" + "Mas tarde". Pulsar Actualizar manda
 * SKIP_WAITING al SW y recarga la pagina cuando este toma el control.
 */
declare global {
  interface WindowEventMap {
    'sw-update-available': CustomEvent<{ updateSW: (reload?: boolean) => Promise<void> }>;
  }
}

export default function PwaUpdatePrompt() {
  const { t } = useTranslation();
  const [updateFn, setUpdateFn] = useState<
    null | ((reload?: boolean) => Promise<void>)
  >(null);

  useEffect(() => {
    const handler = (e: WindowEventMap['sw-update-available']) => {
      setUpdateFn(() => e.detail.updateSW);
    };
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);

  if (!updateFn) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-xl border border-border bg-card px-4 py-3 shadow-xl flex items-center gap-3 motion-reduce:animate-none"
    >
      <span className="text-sm">
        {t('pwa.updateAvailable', 'Hay una version nueva disponible.')}
      </span>
      <button
        type="button"
        onClick={() => {
          updateFn(true);
        }}
        className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-[36px]"
      >
        {t('pwa.updateNow', 'Actualizar')}
      </button>
      <button
        type="button"
        onClick={() => setUpdateFn(null)}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-[36px]"
      >
        {t('pwa.later', 'Mas tarde')}
      </button>
    </div>
  );
}
