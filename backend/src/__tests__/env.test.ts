/**
 * Hito H-1.1 (S-01) — Verifica fail-fast del módulo de configuración cuando
 * faltan secretos críticos (VAPID) en producción.
 *
 * En desarrollo y test, el módulo debe seguir cargando sin lanzar.
 */

const ORIGINAL_ENV = { ...process.env };

const restoreEnv = () => {
    Object.keys(process.env).forEach((k) => {
        if (!(k in ORIGINAL_ENV)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
};

const setProdSecretsExceptVapid = () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'x';
    process.env.REFRESH_TOKEN_SECRET = 'x';
    process.env.FIELD_ENCRYPTION_KEY = 'k'.repeat(32);
    process.env.STRIPE_SECRET_KEY = 'sk';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
    process.env.INTERNAL_API_KEY = 'ik';
};

afterEach(() => {
    restoreEnv();
    jest.resetModules();
});

describe('config/env (Hito H-1.1)', () => {
    test('arroja FATAL en producción si falta VAPID_PRIVATE_KEY', () => {
        setProdSecretsExceptVapid();
        process.env.VAPID_PUBLIC_KEY = 'pub';
        delete process.env.VAPID_PRIVATE_KEY;

        expect(() => {
            jest.isolateModules(() => {
                require('../config/env');
            });
        }).toThrow(/VAPID_PRIVATE_KEY/);
    });

    test('arroja FATAL en producción si falta VAPID_PUBLIC_KEY', () => {
        setProdSecretsExceptVapid();
        process.env.VAPID_PRIVATE_KEY = 'prv';
        delete process.env.VAPID_PUBLIC_KEY;

        expect(() => {
            jest.isolateModules(() => {
                require('../config/env');
            });
        }).toThrow(/VAPID_PUBLIC_KEY/);
    });

    test('en development, claves VAPID vacías son tolerables (no throw)', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;

        let cfg: any;
        expect(() => {
            jest.isolateModules(() => {
                cfg = require('../config/env').config;
            });
        }).not.toThrow();
        expect(cfg.vapid.publicKey).toBe('');
        expect(cfg.vapid.privateKey).toBe('');
    });

    test('en producción, con ambas claves definidas, carga correctamente', () => {
        setProdSecretsExceptVapid();
        process.env.VAPID_PUBLIC_KEY = 'BPub_test_value';
        process.env.VAPID_PRIVATE_KEY = 'priv_test_value';

        let cfg: any;
        jest.isolateModules(() => {
            cfg = require('../config/env').config;
        });
        expect(cfg.vapid.publicKey).toBe('BPub_test_value');
        expect(cfg.vapid.privateKey).toBe('priv_test_value');
    });

    test('no quedan claves VAPID hardcodeadas en el módulo', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;

        let cfg: any;
        jest.isolateModules(() => {
            cfg = require('../config/env').config;
        });
        // Defensa en profundidad: los antiguos fallbacks (auditoría S-01) no
        // deben aparecer ni siquiera en dev. Reconstruimos los prefijos sin
        // literalizarlos para que `grep` sobre el repo siga retornando vacío.
        const oldPubPrefix = ['BGsc', 'sMyO', '1ynE'].join('');
        const oldPrvPrefix = ['0XNr', 'TZGc', 'DO'].join('');
        expect(cfg.vapid.publicKey.startsWith(oldPubPrefix)).toBe(false);
        expect(cfg.vapid.privateKey.startsWith(oldPrvPrefix)).toBe(false);
        expect(cfg.vapid.publicKey).toBe('');
        expect(cfg.vapid.privateKey).toBe('');
    });
});
