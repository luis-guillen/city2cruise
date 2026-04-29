// Hito H-2.4 (I-01) — ESLint dedicado al backend.
//
// Alcance acotado por la auditoría: cuatro reglas duras orientadas a
// detectar promesas mal manejadas y a forzar el uso del logger
// estructurado. El resto de reglas (no-unsafe-*, restrict-template-
// expressions, etc.) se posponen a H-5.x para no bloquear el cierre del
// Capítulo 2 con cientos de warnings preexistentes.
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'src/__tests__', 'eslint.config.js'] },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
            parserOptions: {
                project: './tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/no-explicit-any': 'warn',
            // Hito H-2.2 (S-08): tras el codemod, no-console pasa a error.
            // Sólo console.warn y console.error siguen permitidos.
            'no-console': ['error', { allow: ['warn', 'error'] }],
        },
    },
);
