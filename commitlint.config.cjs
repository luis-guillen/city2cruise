/**
 * Hito 5.1.4 — Conventional Commits enforcement.
 *
 * Tipos validos: feat, fix, perf, refactor, docs, test, build, ci, chore,
 *                style, revert.
 * Body opcional, footer opcional.
 *
 * Activado en CI via .github/workflows/commitlint.yml y opcionalmente
 * como husky/commit-msg hook (npm install -D husky && npx husky init).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'body-max-line-length': [2, 'always', 100],
    'header-max-length': [2, 'always', 100],
    'type-enum': [
      2,
      'always',
      ['feat','fix','perf','refactor','docs','test','build','ci','chore','style','revert']
    ]
  }
};
