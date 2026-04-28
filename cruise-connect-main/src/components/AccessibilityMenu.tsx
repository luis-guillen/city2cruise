import { useEffect, useRef, useState } from 'react';
import { Accessibility } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAccessibility,
  type AccessibilityProfile,
  type ContrastMode,
  type AppLanguage,
} from '@/context/AccessibilityContext';

/**
 * Menú flotante para que el usuario seleccione perfil, contraste,
 * reduced motion e idioma. Cumple el patrón ARIA disclosure + dialog.
 *
 * Hito 4.1.4 / 4.1.5 / 4.1.6.
 */
export default function AccessibilityMenu() {
  const {
    profile,
    contrast,
    reducedMotion,
    language,
    setProfile,
    setContrast,
    setReducedMotion,
    setLanguage,
  } = useAccessibility();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="a11y-menu"
        aria-label={t("a11y.menuTitle")}
        title={t("a11y.menuTitle")}
        className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Accessibility className="h-5 w-5" aria-hidden="true" focusable="false" />
      </button>

      {open && (
        <div
          id="a11y-menu"
          role="dialog"
          aria-modal="false"
          aria-labelledby="a11y-menu-title"
          className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-card p-4 shadow-lg z-50 motion-reduce:animate-none"
        >
          <h3 id="a11y-menu-title" className="font-semibold text-sm mb-3">
            {t("a11y.menu")}
          </h3>

          <fieldset className="space-y-2 mb-4">
            <legend className="text-xs font-medium text-muted-foreground mb-1">
              {t("a11y.profile")}
            </legend>
            {(
              [
                { id: 'standard', label: t('a11y.profileStandard') },
                { id: 'age_advanced', label: t('a11y.profileAge') },
                { id: 'pmr', label: t('a11y.profilePmr') },
              ] as Array<{ id: AccessibilityProfile; label: string }>
            ).map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-2 cursor-pointer min-h-[36px] rounded-md px-2 py-1 hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name="a11y-profile"
                  value={opt.id}
                  checked={profile === opt.id}
                  onChange={() => setProfile(opt.id)}
                  className="h-4 w-4"
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2 mb-4">
            <legend className="text-xs font-medium text-muted-foreground mb-1">
              {t("a11y.contrast")}
            </legend>
            {(
              [
                { id: 'auto', label: t('a11y.contrastAuto') },
                { id: 'high', label: t('a11y.contrastHigh') },
              ] as Array<{ id: ContrastMode; label: string }>
            ).map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-2 cursor-pointer min-h-[36px] rounded-md px-2 py-1 hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name="a11y-contrast"
                  value={opt.id}
                  checked={contrast === opt.id}
                  onChange={() => setContrast(opt.id)}
                  className="h-4 w-4"
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 cursor-pointer min-h-[36px] rounded-md px-2 py-1 hover:bg-muted/50 mb-4">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setReducedMotion(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">{t("a11y.reducedMotion")}</span>
          </label>

          <fieldset>
            <legend className="text-xs font-medium text-muted-foreground mb-1">
              {t("a11y.language")}
            </legend>
            <label className="sr-only" htmlFor="a11y-language">
              {t("a11y.languageAria")}
            </label>
            <select
              id="a11y-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
            </select>
          </fieldset>
        </div>
      )}
    </div>
  );
}
