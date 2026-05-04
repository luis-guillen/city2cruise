import { useState } from 'react';
import { interveneCancel, interveneForceAssign } from '@/services/twin';

interface ManualInterventionPanelProps {
  requestId: number;
  currentDriverId?: number | null;
  onCompleted?: () => void;
}

export function ManualInterventionPanel({
  requestId,
  currentDriverId = null,
  onCompleted,
}: ManualInterventionPanelProps) {
  const [busyAction, setBusyAction] = useState<'cancel' | 'assign' | null>(null);
  const [driverIdInput, setDriverIdInput] = useState(currentDriverId ? String(currentDriverId) : '');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'cancel' | 'assign', fn: () => Promise<void>) => {
    setBusyAction(action);
    setFeedback(null);
    setError(null);
    try {
        await fn();
        setFeedback(action === 'cancel' ? 'Request cancelada manualmente.' : 'Asignación forzada enviada.');
        onCompleted?.();
    } catch (err) {
        setError((err as Error).message);
    } finally {
        setBusyAction(null);
    }
  };

  return (
    <section
      aria-label="Intervención manual"
      style={{
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: '1rem',
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Intervención manual</h2>
      <p style={{ marginTop: 0, color: '#4b5563' }}>
        Solicitud #{requestId}
      </p>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => run('cancel', () => interveneCancel(requestId, 'operator override'))}
          style={{
            background: '#b91c1c',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '0.75rem 1rem',
            cursor: busyAction ? 'default' : 'pointer',
          }}
        >
          {busyAction === 'cancel' ? 'Cancelando...' : 'Cancelar solicitud'}
        </button>

        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span style={{ fontWeight: 600 }}>Forzar conductor</span>
          <input
            type="number"
            inputMode="numeric"
            value={driverIdInput}
            onChange={(event) => setDriverIdInput(event.target.value)}
            placeholder="ID conductor"
            disabled={busyAction !== null}
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '0.65rem 0.75rem',
            }}
          />
        </label>

        <button
          type="button"
          disabled={busyAction !== null || !driverIdInput.trim()}
          onClick={() => run('assign', () => interveneForceAssign(requestId, Number(driverIdInput)))}
          style={{
            background: '#0f766e',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '0.75rem 1rem',
            cursor: busyAction || !driverIdInput.trim() ? 'default' : 'pointer',
          }}
        >
          {busyAction === 'assign' ? 'Asignando...' : 'Forzar asignacion de conductor'}
        </button>
      </div>

      {feedback ? <p role="status" style={{ color: '#166534', marginBottom: 0 }}>{feedback}</p> : null}
      {error ? <p role="alert" style={{ color: '#b91c1c', marginBottom: 0 }}>{error}</p> : null}
    </section>
  );
}
