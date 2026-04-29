import { useEffect, useState } from 'react';
import { subscribeRLRankings, type RLRankingUpdate } from '@/services/twin';

export function RLRankingTable({ requestId }: { requestId: number | null }) {
  const [latest, setLatest] = useState<RLRankingUpdate | null>(null);

  useEffect(() => {
    return subscribeRLRankings((update) => {
      if (requestId !== null && update.requestId === requestId) {
        setLatest(update);
      }
    });
  }, [requestId]);

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
      <h2 style={{ marginTop: 0 }}>Ranking RL</h2>
      {!requestId ? <p style={{ color: '#6b7280', marginBottom: 0 }}>Selecciona una request para ver rankings.</p> : null}
      {requestId && (!latest || latest.rankings.length === 0) ? (
        <p style={{ color: '#6b7280', marginBottom: 0 }}>Sin ranking en vivo todavía para esta request.</p>
      ) : null}
      {latest && latest.rankings.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Rank</th>
              <th align="left">Driver</th>
              <th align="left">Score</th>
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
    </section>
  );
}
