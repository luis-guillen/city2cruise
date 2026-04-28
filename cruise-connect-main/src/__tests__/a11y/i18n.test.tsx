import { describe, it, expect } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES, isSupportedLanguage } from '@/i18n';

const REQUIRED_KEYS = [
  'app.name',
  'common.save',
  'common.cancel',
  'auth.loginTitle',
  'auth.registerTitle',
  'auth.logout',
  'navbar.userActions',
  'navbar.logoutTitle',
  'notifications.title',
  'notifications.empty',
  'tracking.altTitle',
  'tracking.showMap',
  'a11y.menu',
  'a11y.profileStandard',
  'a11y.profileAge',
  'a11y.profilePmr',
  'a11y.contrastHigh',
  'a11y.reducedMotion',
  'a11y.skipToContent',
  'footer.copyright',
];

describe('Hito 4.1.6 — i18n cobertura de lenguas', () => {
  it('SUPPORTED_LANGUAGES incluye los 5 idiomas', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['es', 'en', 'fr', 'de', 'it']);
  });

  it('isSupportedLanguage reconoce los soportados y rechaza el resto', () => {
    expect(isSupportedLanguage('es')).toBe(true);
    expect(isSupportedLanguage('it')).toBe(true);
    expect(isSupportedLanguage('zh')).toBe(false);
    expect(isSupportedLanguage('xx')).toBe(false);
  });

  describe('todas las claves obligatorias presentes en cada idioma', () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      it(`locale ${lng}`, async () => {
        await i18n.changeLanguage(lng);
        for (const key of REQUIRED_KEYS) {
          const v = i18n.t(key);
          expect(typeof v, `${lng}: ${key} no devolvio string`).toBe('string');
          expect(v, `${lng}: ${key} vacio o igual al key`).not.toBe(key);
          expect((v as string).length, `${lng}: ${key} vacio`).toBeGreaterThan(0);
        }
      });
    }
  });

  it('cambio de idioma vía i18n.changeLanguage actualiza las traducciones', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('auth.logout')).toBe('Salir');
    await i18n.changeLanguage('en');
    expect(i18n.t('auth.logout')).toBe('Sign out');
    await i18n.changeLanguage('fr');
    expect(i18n.t('auth.logout')).toBe('Déconnexion');
    await i18n.changeLanguage('de');
    expect(i18n.t('auth.logout')).toBe('Abmelden');
    await i18n.changeLanguage('it');
    expect(i18n.t('auth.logout')).toBe('Esci');
    await i18n.changeLanguage('es');
  });

  it('interpolación funciona en todos los idiomas', async () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      await i18n.changeLanguage(lng);
      const v = i18n.t('auth.welcome', { name: 'Pablo' });
      expect(v).toContain('Pablo');
    }
    await i18n.changeLanguage('es');
  });
});
