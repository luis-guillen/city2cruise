/**
 * Hito 5.4.4 — Torre de Control.
 *
 * Panel admin que muestra el estado en tiempo real del Digital Twin:
 * - KPIs agregados (lockers libres/ocupados, drivers online, requests activas)
 * - Mapa con drivers (azul si available, naranja si busy) y lockers
 * - Auto-refresh cada 5s
 *
 * Read-only: nunca muta estado del twin desde el frontend.
 */
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import {
  fetchTwinSnapshot,
  type TwinSnapshot,
} from "@/services/twin";

const REFRESH_MS = 5000;
const DEFAULT_CENTER: [number, number] = [28.1235, -15.4363]; // Las Palmas

const lockerColor = (status: string) => {
  switch (status) {
    case "free": return "#22c55e"; // green
    case "reserved": return "#eab308"; // yellow
    case "occupied": return "#ef4444"; // red
    case "out_of_service": return "#6b7280"; // gray
    default: return "#3b82f6";
  }
};

const driverColor = (status: string) => {
  switch (status) {
    case "available": return "#3b82f6"; // blue
    case "busy": return "#f97316"; // orange
    case "breaking": return "#a855f7"; // purple
    case "offline": return "#9ca3af"; // gray
    default: return "#3b82f6";
  }
};

export default function ControlTowerPage() {
  const [snapshot, setSnapshot] = useState<TwinSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchTwinSnapshot();
        if (cancelled) return;
        setSnapshot(s);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const agg = snapshot?.aggregates;

  return (
    <div className="control-tower" style={{ padding: "1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Torre de Control</h1>
          <small style={{ color: "#666" }}>
            env: <strong>{snapshot?.env ?? "—"}</strong>
            {" · "}
            actualizado: {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
            {" · "}
            refresco cada {REFRESH_MS / 1000}s
          </small>
        </div>
        {error && (
          <div role="alert" style={{ color: "#b91c1c" }}>
            ⚠ Twin no responde: {error}
          </div>
        )}
      </header>

      {/* KPIs */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
        aria-label="KPIs en tiempo real"
      >
        <Kpi label="Lockers libres" value={agg?.lockers_free} total={agg?.lockers_total} accent="#22c55e" />
        <Kpi label="Lockers ocupados" value={agg?.lockers_occupied} total={agg?.lockers_total} accent="#ef4444" />
        <Kpi label="Lockers fuera de servicio" value={agg?.lockers_out} total={agg?.lockers_total} accent="#6b7280" />
        <Kpi label="Drivers online" value={agg?.drivers_online} total={agg?.drivers_total} accent="#3b82f6" />
        <Kpi label="Drivers disponibles" value={agg?.drivers_available} total={agg?.drivers_total} accent="#3b82f6" />
        <Kpi label="Requests activas" value={agg?.requests_active} accent="#f97316" />
        <Kpi
          label="Tiempo de match (15m)"
          value={agg?.avg_match_seconds_15m ? `${agg.avg_match_seconds_15m}s` : "—"}
          accent="#a855f7"
        />
      </section>

      {/* Mapa */}
      <section style={{ height: "60vh", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          aria-label="Mapa Torre de Control con drivers y lockers"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {snapshot?.lockers.map((l) => (
            <CircleMarker
              key={`L-${l.id}`}
              center={[l.latitude, l.longitude]}
              radius={8}
              pathOptions={{ color: lockerColor(l.status), fillOpacity: 0.6 }}
            >
              <Tooltip>
                <div>
                  <strong>{l.label}</strong>
                  <br />estado: {l.status}
                  <br />ocupación: {l.occupancy_pct}%
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
          {snapshot?.drivers.map((d) => (
            <CircleMarker
              key={`D-${d.id}`}
              center={[d.latitude, d.longitude]}
              radius={6}
              pathOptions={{ color: driverColor(d.status), fillOpacity: 0.8 }}
            >
              <Tooltip>
                <div>
                  <strong>{d.name}</strong>
                  <br />estado: {d.status}
                  {d.current_request_id ? <><br />request: #{d.current_request_id}</> : null}
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </section>
    </div>
  );
}

function Kpi(props: { label: string; value?: number | string | null; total?: number; accent?: string }) {
  const display = props.value === undefined || props.value === null ? "—" : props.value;
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid #e5e7eb`,
        borderTop: `4px solid ${props.accent ?? "#3b82f6"}`,
        borderRadius: "6px",
        padding: "0.75rem 1rem",
      }}
    >
      <div style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{props.label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
        {display}
        {props.total !== undefined ? <span style={{ color: "#9ca3af", fontSize: "0.9rem" }}> / {props.total}</span> : null}
      </div>
    </div>
  );
}
