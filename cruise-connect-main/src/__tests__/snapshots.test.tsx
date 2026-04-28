/**
 * Hito 6.1.4 — Snapshot tests para detectar cambios visuales no intencionados.
 *
 * Cubre los componentes UI más críticos: StatusBadge en sus distintos estados,
 * NavLink, MapTextAlternative.
 *
 * Nota: vitest serializa el HTML resultante; los snapshots se almacenan en
 * __snapshots__/snapshots.test.tsx.snap. Cualquier cambio visual rompe el test
 * hasta que se actualice con `vitest -u`.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusBadge from '@/components/StatusBadge';
import { NavLink } from '@/components/NavLink';
import MapTextAlternative from '@/components/MapTextAlternative';
import { AccessibilityProvider } from '@/context/AccessibilityContext';

describe('Hito 6.1.4 — Snapshots de UI crítica', () => {
  describe('StatusBadge', () => {
    const statuses: Array<
      'REQUESTED' | 'ACCEPTED' | 'CONFIRMATION_PENDING' | 'IN_PROGRESS' | 'DEPOSITED' | 'PICKED_UP'
    > = ['REQUESTED', 'ACCEPTED', 'CONFIRMATION_PENDING', 'IN_PROGRESS', 'DEPOSITED', 'PICKED_UP'];

    statuses.forEach((s) => {
      it(`StatusBadge[${s}] mantiene snapshot`, () => {
        const { container } = render(<StatusBadge status={s} />);
        expect(container.firstChild).toMatchSnapshot();
      });
    });
  });

  describe('NavLink', () => {
    it('inactivo mantiene snapshot', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/x']}>
          <NavLink to="/admin" className="base" activeClassName="active">
            Admin
          </NavLink>
        </MemoryRouter>
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('activo (ruta coincide) mantiene snapshot', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/admin']}>
          <NavLink to="/admin" className="base" activeClassName="active">
            Admin
          </NavLink>
        </MemoryRouter>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('MapTextAlternative', () => {
    it('completo (con distancia, ETA, status, 2 locations) mantiene snapshot', () => {
      window.localStorage.setItem('a11y:settings:v1', JSON.stringify({
        profile: 'pmr', contrast: 'auto', reducedMotion: false, language: 'es',
      }));

      const { container } = render(
        <AccessibilityProvider>
          <MapTextAlternative
            title="Trayecto"
            locations={[
              { label: 'Tu posición', latitude: 28.123, longitude: -15.436 },
              { label: 'Conductor', latitude: 28.130, longitude: -15.430, meta: 'ETA 5 min' },
            ]}
            distanceKm={1.4}
            etaMinutes={7}
            statusText="En camino al locker"
          />
        </AccessibilityProvider>
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
