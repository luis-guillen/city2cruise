import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: 'es',
        supportedLngs: ['es', 'en', 'fr', 'de', 'it', 'ca'],
        defaultNS: 'translation',
        ns: ['translation'],

        backend: {
            loadPath: '/locales/{{lng}}/{{ns}}.json',
        },

        detection: {
            // Browser language → localStorage preference → navigator
            order: ['localStorage', 'navigator', 'htmlTag'],
            caches: ['localStorage'],
            lookupLocalStorage: 'i18n_lng',
        },

        interpolation: {
            // React already escapes values
            escapeValue: false,
        },

        react: {
            // Show keys while translation loads to avoid blank UI flashes
            useSuspense: false,
        },
    });

export default i18n;
