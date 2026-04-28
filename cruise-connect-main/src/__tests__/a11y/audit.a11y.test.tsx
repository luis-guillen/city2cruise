/**
 * Hito 4.1.1 — Auditoria de accesibilidad programatica (axe-core)
 * Ejecuta axe-core/4.x sobre las paginas y componentes clave del frontend.
 * Genera un JSON consolidado en docs/audits/a11y-results.json.
 *
 * Modo "discovery": SOFT_ASSERT=true por defecto recopila violaciones sin
 * romper la build. Para CI estricto: A11Y_STRICT=1 npm test.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';

import LoginPage from '@/pages/LoginPage';
import NotFound from '@/pages/NotFound';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/StatusBadge';
import { AppProvider } from '@/context/AppContext';

const SOFT_ASSERT = process.env.A11Y_STRICT !== '1';
const REPORT_PATH = path.resolve(
  __dirname,
  '../../../../docs/audits/a11y-results.json'
);

type Finding = {
  scope: string;
  violations: Array<{
    id: string;
    impact: string | null | undefined;
    help: string;
    nodes: number;
    helpUrl: string;
  }>;
};

const collected: Finding[] = [];

function record(scope: string, results: Awaited<ReturnType<typeof axe>>) {
  const violations = (results.violations || []).map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.length,
    helpUrl: v.helpUrl,
  }));
  collected.push({ scope, violations });
  if (!SOFT_ASSERT && violations.length > 0) {
    throw new Error(
      `[a11y][${scope}] ${violations.length} violations:\n` +
        violations.map((v) => ` - ${v.id} (${v.impact}): ${v.help}`).join('\n')
    );
  }
}

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AppProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProvider>
    </QueryClientProvider>
  );
};

describe('Hito 4.1.1 — Auditoria a11y (discovery)', () => {
  beforeAll(() => {
    collected.length = 0;
  });

  afterAll(() => {
    try {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      const total = collected.reduce((acc, c) => acc + c.violations.length, 0);
      fs.writeFileSync(
        REPORT_PATH,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            mode: SOFT_ASSERT ? 'soft' : 'strict',
            totals: { scopes: collected.length, violations: total },
            results: collected,
          },
          null,
          2
        )
      );
      // eslint-disable-next-line no-console
      console.log(
        `\n[a11y] reporte escrito en ${path.relative(process.cwd(), REPORT_PATH)} ` +
          `(${total} violaciones en ${collected.length} scopes)`
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[a11y] no se pudo escribir el reporte:', e);
    }
  });

  it('LoginPage', async () => {
    const { container } = render(wrap(<LoginPage />));
    const results = await axe(container);
    record('pages/LoginPage', results);
    cleanup();
  });

  it('NotFound', async () => {
    const { container } = render(wrap(<NotFound />));
    const results = await axe(container);
    record('pages/NotFound', results);
    cleanup();
  });

  it('UI primitives (Button / Input / Card / Badge)', async () => {
    const { container } = render(
      wrap(
        <div>
          <Button>Confirmar</Button>
          <label htmlFor="email">Email</label>
          <Input id="email" type="email" placeholder="tu@correo.com" />
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge>Activo</Badge>
            </CardContent>
          </Card>
        </div>
      )
    );
    const results = await axe(container);
    record('components/ui/primitives', results);
    cleanup();
  });

  it('StatusBadge (todos los estados)', async () => {
    const { container } = render(
      wrap(
        <div>
          <StatusBadge status="REQUESTED" />
          <StatusBadge status="ACCEPTED" />
          <StatusBadge status="PICKED_UP" />
          <StatusBadge status="DEPOSITED" />
          <StatusBadge status="IN_PROGRESS" />
        </div>
      )
    );
    const results = await axe(container);
    record('components/StatusBadge', results);
    cleanup();
  });
});
