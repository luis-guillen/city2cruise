/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    clearMocks: true,
    silent: true,
    setupFiles: ['<rootDir>/src/__tests__/jest.setup.ts'],
    testTimeout: 15000,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'json-summary'],
    coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/__tests__/**',
        '!src/db/seed*.ts',
        '!src/db/reset.ts',
        '!src/index.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 56,
            functions: 63,
            lines: 71,
            statements: 71,
        },
    },
};
