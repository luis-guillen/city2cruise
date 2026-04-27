const COMMON_PASSWORDS = new Set([
    'password', 'password1', '123456', '12345678', '1234567890', 'qwerty',
    'qwerty123', 'abc123', 'iloveyou', 'admin', 'letmein', 'monkey', 'dragon',
    'master', 'sunshine', 'princess', 'welcome', 'shadow', 'superman', 'michael',
    '111111', '000000', 'pass1234', 'test1234', 'passw0rd',
]);

export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < 8) {
        errors.push('Mínimo 8 caracteres');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Al menos una letra mayúscula');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Al menos una letra minúscula');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Al menos un número');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Al menos un carácter especial (!@#$%^&*...)');
    }
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        errors.push('Contraseña demasiado común, elige una más segura');
    }

    return { valid: errors.length === 0, errors };
}
