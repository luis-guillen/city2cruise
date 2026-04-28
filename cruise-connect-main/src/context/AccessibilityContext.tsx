import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Hito 4.1.4 / 4.1.5 — Accessibility provider.
 *
 * Aplica los perfiles de la tabla `users.profile` (BD existente):
 *  - standard      → defaults
 *  - age_advanced  → fuente base 18px, tap targets 48px, animaciones
 *                    suavizadas, espaciado generoso, copy simplificado.
 *  - pmr           → optimizado para lectores de pantalla (anuncios
 *                    aria-live más verbosos), vista alternativa al mapa.
 *
 * Tres estados extra ortogonales (no exclusivos del perfil):
 *  - contrast: 'auto' | 'high'
 *  - reducedMotion: boolean (auto-detectado de prefers-reduced-motion)
 *  - language: 'es' | 'en' | 'fr' | 'de' | 'it' (Hito 4.1.6)
 *
 * Persiste en localStorage y aplica los tokens vía data-attributes en <html>.
 */
export type AccessibilityProfile = 'standard' | 'age_advanced' | 'pmr';
export type ContrastMode = 'auto' | 'high';
export type AppLanguage = 'es' | 'en' | 'fr' | 'de' | 'it';

interface AccessibilityState {
  profile: AccessibilityProfile;
  contrast: ContrastMode;
  reducedMotion: boolean;
  language: AppLanguage;

  setProfile: (p: AccessibilityProfile) => void;
  setContrast: (c: ContrastMode) => void;
  setReducedMotion: (b: boolean) => void;
  setLanguage: (l: AppLanguage) => void;
}

const STORAGE_KEY = 'a11y:settings:v1';
const DEFAULTS: Pick<
  AccessibilityState,
  'profile' | 'contrast' | 'reducedMotion' | 'language'
> = {
  profile: 'standard',
  contrast: 'auto',
  reducedMotion: false,
  language: 'es',
};

const AccessibilityContext = createContext<AccessibilityState | undefined>(
  undefined
);

function readPersisted(): typeof DEFAULTS {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      profile:
        ['standard', 'age_advanced', 'pmr'].includes(parsed.profile)
          ? parsed.profile
          : DEFAULTS.profile,
      contrast:
        ['auto', 'high'].includes(parsed.contrast)
          ? parsed.contrast
          : DEFAULTS.contrast,
      reducedMotion: !!parsed.reducedMotion,
      language:
        ['es', 'en', 'fr', 'de', 'it'].includes(parsed.language)
          ? parsed.language
          : DEFAULTS.language,
    };
  } catch {
    return DEFAULTS;
  }
}

function detectSystemReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const persisted = readPersisted();
  const [profile, setProfile] = useState<AccessibilityProfile>(persisted.profile);
  const [contrast, setContrast] = useState<ContrastMode>(persisted.contrast);
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    persisted.reducedMotion || detectSystemReducedMotion()
  );
  const [language, setLanguage] = useState<AppLanguage>(persisted.language);

  // Persistir
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ profile, contrast, reducedMotion, language })
      );
    } catch {
      /* private browsing / SSR */
    }
  }, [profile, contrast, reducedMotion, language]);

  // Reflejar en <html data-*>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.a11yProfile = profile;
    root.dataset.a11yContrast = contrast === 'high' ? 'high' : 'off';
    root.dataset.a11yReducedMotion = reducedMotion ? '1' : '0';
    root.lang = language;
  }, [profile, contrast, reducedMotion, language]);

  // Watcher del system reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    if ('addEventListener' in mql) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
  }, []);

  const value = useMemo<AccessibilityState>(
    () => ({
      profile,
      contrast,
      reducedMotion,
      language,
      setProfile,
      setContrast,
      setReducedMotion,
      setLanguage,
    }),
    [profile, contrast, reducedMotion, language]
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAccessibility(): AccessibilityState {
  const ctx = useContext(AccessibilityContext);
  if (!ctx)
    throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}
