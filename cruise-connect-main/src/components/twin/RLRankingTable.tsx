import { useEffect, useMemo, useState } from 'react';
import { subscribeRLRankings, type RLRankingUpdate } from '@/services/twin';

const THINKING_STEPS = [
  'Evaluando a los conductores frente a la solicitud activa',
  'Comparando ETA, urgencia y posicion actual',
  'Ordenando los mejores candidatos para el despacho',
];

export function RLRankingTable({ requestId }: { requestId: number | null }) {
  const [latest, setLatest] = useState<RLRankingUpdate | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);

  useEffect(() => {
    return subscribeRLRankings((update) => {
      if (requestId !== null && update.requestId === requestId) {
        setLatest(update);
      }
    });
  }, [requestId]);

  const thinking = requestId !== null && (!latest || latest.rankings.length === 0);
  const headerMeta = useMemo(() => {
    if (!latest) return null;
    const bits: string[] = [];
    if (latest.modelVersion) bits.push(latest.modelVersion);
    if (typeof latest.inferenceMs === 'number') bits.push(`${latest.inferenceMs.toFixed(0)} ms`);
    return bits.join(' · ');
  }, [latest]);

  useEffect(() => {
    if (!thinking) return;

    const id = window.setInterval(() => {
      setThinkingStep((current) => (current + 1) % THINKING_STEPS.length);
    }, 1400);

    return () => window.clearInterval(id);
  }, [thinking]);

  return (
    <section
      aria-label="Ranking RL"
      style={{
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: '0.15rem' }}>Ranking de IA</h2>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '0.92rem' }}>
            Seleccion asistida por IA para la solicitud activa.
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.35rem 0.65rem',
            borderRadius: 999,
            border: '1px solid ' + (thinking ? '#f59e0b' : '#10b981'),
            background: thinking ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            color: thinking ? '#92400e' : '#065f46',
            fontWeight: 700,
            fontSize: '0.82rem',
            letterSpacing: '0.02em',
          }}
          aria-live="polite"
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: thinking ? '#f59e0b' : '#10b981',
              boxShadow: thinking ? '0 0 0 6px rgba(245, 158, 11, 0.18)' : '0 0 0 6px rgba(16, 185, 129, 0.18)',
              animation: thinking ? 'pulse 1.1s ease-in-out infinite' : 'none',
            }}
          />
          {thinking ? 'ANALIZANDO…' : 'IA LISTA'}
        </div>
      </div>

      {headerMeta ? (
        <div style={{ marginBottom: '0.75rem', padding: '0.55rem 0.75rem', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.9rem' }}>
          {headerMeta}
        </div>
      ) : null}

      {!requestId ? <p style={{ color: '#6b7280', marginBottom: 0 }}>Selecciona una solicitud para ver el ranking.</p> : null}
      {requestId && thinking ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#6b7280' }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #cbd5e1',
              borderTopColor: '#0f766e',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <div>
            <p style={{ margin: 0, fontWeight: 600, color: '#334155' }}>
              La IA está evaluando la mejor combinación de conductor, urgencia y ETA.
            </p>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.9rem' }}>
              {THINKING_STEPS[thinkingStep]}
            </p>
          </div>
        </div>
      ) : null}
      {latest && latest.rankings.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left" style={{ padding: '0.35rem 0' }}>Puesto</th>
              <th align="left" style={{ padding: '0.35rem 0' }}>Conductor</th>
              <th align="left" style={{ padding: '0.35rem 0' }}>Puntuacion</th>
            </tr>
          </thead>
          <tbody>
            {latest.rankings.map((entry) => (
              <tr key={entry.driverId}>
                <td style={{ padding: '0.35rem 0' }}>{entry.rank + 1}</td>
                <td style={{ padding: '0.35rem 0' }}>#{entry.driverId}</td>
                <td style={{ padding: '0.35rem 0' }}>{entry.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.92); opacity: 0.75; }
          50% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(0.92); opacity: 0.75; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeInOut {
          0% { opacity: 0.45; transform: translateY(1px); }
          50% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.45; transform: translateY(1px); }
        }
      `}</style>
    </section>
  );
}
