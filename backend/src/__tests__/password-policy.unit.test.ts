/**
 * Tests unitarios de la política de contraseñas (sin BD).
 */
import { validatePassword } from '../auth/passwordPolicy';

describe('validatePassword', () => {
    it('pasa contraseña fuerte', () => {
        const { valid, errors } = validatePassword('SecurePass1!');
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
    });

    it('rechaza contraseña corta', () => {
        const { valid, errors } = validatePassword('Ab1!');
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('8'))).toBe(true);
    });

    it('rechaza sin mayúscula', () => {
        const { valid, errors } = validatePassword('testpass1!');
        expect(valid).toBe(false);
        expect(errors.some(e => /mayúscula/i.test(e))).toBe(true);
    });

    it('rechaza sin minúscula', () => {
        const { valid, errors } = validatePassword('TESTPASS1!');
        expect(valid).toBe(false);
        expect(errors.some(e => /minúscula/i.test(e))).toBe(true);
    });

    it('rechaza sin número', () => {
        const { valid, errors } = validatePassword('TestPass!!');
        expect(valid).toBe(false);
        expect(errors.some(e => /número/i.test(e))).toBe(true);
    });

    it('rechaza sin carácter especial', () => {
        const { valid, errors } = validatePassword('TestPass1');
        expect(valid).toBe(false);
        expect(errors.some(e => /especial/i.test(e))).toBe(true);
    });

    it('rechaza contraseña común', () => {
        const { valid, errors } = validatePassword('password');
        expect(valid).toBe(false);
        expect(errors.some(e => /común/i.test(e))).toBe(true);
    });

    it('recoge múltiples errores a la vez para una contraseña débil', () => {
        const { valid, errors } = validatePassword('abc');
        expect(valid).toBe(false);
        expect(errors.length).toBeGreaterThan(2);
    });
});
