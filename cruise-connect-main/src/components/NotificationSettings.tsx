import { useState, useEffect } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getNotificationPrefs, updateNotificationPrefs, type NotificationPrefs } from '@/services/api';

const LOCALES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'ca', label: 'Català' },
] as const;

export function NotificationSettings() {
  const { isSupported, permissionState, isSubscribing, subscribe, unsubscribe } = usePushNotifications();

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNotificationPrefs()
      .then((p) => {
        setPrefs(p);
        setPhone(p.phone || '');
      })
      .catch(() => setError('No se pudieron cargar las preferencias'));
  }, []);

  const handlePushToggle = async () => {
    if (!prefs) return;
    if (prefs.push_enabled) {
      await unsubscribe();
      await save({ ...prefs, push_enabled: false });
    } else {
      const ok = await subscribe();
      if (ok) await save({ ...prefs, push_enabled: true });
    }
  };

  const save = async (updated: NotificationPrefs) => {
    setSaving(true);
    setError(null);
    try {
      await updateNotificationPrefs({ ...updated, phone: phone || null });
      setPrefs({ ...updated, phone: phone || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Error al guardar las preferencias');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!prefs) return;
    save({ ...prefs, phone: phone || null });
  };

  if (!prefs) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        {error ?? 'Cargando preferencias…'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-gray-900">Notificaciones</h3>

      {/* Push */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Notificaciones push</p>
          {!isSupported && (
            <p className="text-xs text-gray-400 mt-0.5">No disponible en este navegador</p>
          )}
          {isSupported && permissionState === 'denied' && (
            <p className="text-xs text-red-500 mt-0.5">Permiso bloqueado — habilítalo en la configuración del navegador</p>
          )}
        </div>
        <button
          onClick={handlePushToggle}
          disabled={!isSupported || permissionState === 'denied' || isSubscribing}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 ${
            prefs.push_enabled ? 'bg-sky-500' : 'bg-gray-300'
          }`}
          aria-pressed={prefs.push_enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              prefs.push_enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* SMS */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Notificaciones SMS</p>
          <p className="text-xs text-gray-400 mt-0.5">Para OTPs y entregas urgentes</p>
        </div>
        <button
          onClick={() => setPrefs((p) => p ? { ...p, sms_enabled: !p.sms_enabled } : p)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            prefs.sms_enabled ? 'bg-sky-500' : 'bg-gray-300'
          }`}
          aria-pressed={prefs.sms_enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              prefs.sms_enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Phone */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Teléfono (para SMS)
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+34 600 000 000"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      {/* Locale */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Idioma de notificaciones
        </label>
        <select
          value={prefs.locale}
          onChange={(e) => setPrefs((p) => p ? { ...p, locale: e.target.value as NotificationPrefs['locale'] } : p)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          {LOCALES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Save */}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
      >
        {saved ? 'Guardado' : saving ? 'Guardando…' : 'Guardar preferencias'}
      </button>
    </div>
  );
}
