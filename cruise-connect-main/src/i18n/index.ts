import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import it from './locales/it.json';

/**
 * Hito 4.1.6 — Configuracion i18next.
 * Idiomas: ES (default), EN, FR, DE, IT.
 */
export const SUPPORTED_LANGUAGES = ['es', 'en', 'fr', 'de', 'it'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(l: string): l is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(l);
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        es: { translation: es },
        en: { translation: en },
        fr: { translation: fr },
        de: { translation: de },
        it: { translation: it },
      },
      fallbackLng: 'es',
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      interpolation: { escapeValue: false },
      detection: {
        order: ['localStorage', 'navigator', 'htmlTag'],
        caches: ['localStorage'],
        lookupLocalStorage: 'i18nextLng',
      },
      react: { useSuspense: false },
    });
}

export default i18n;
