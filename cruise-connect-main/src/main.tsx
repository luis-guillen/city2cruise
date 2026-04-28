// Hito 5.3.1 — Sentry init ANTES de createRoot
import { initSentry, Sentry } from "./observability/sentry";
initSentry();

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "leaflet/dist/leaflet.css";
import "./index.css";
import "./i18n";
import { registerSW } from "virtual:pwa-register";

const reactRoot = createRoot(document.getElementById("root")!);
reactRoot.render(
  <Sentry.ErrorBoundary fallback={<p style={{padding:"2rem"}}>Algo se rompió. Recarga la página o vuelve más tarde.</p>}>
    <App />
  </Sentry.ErrorBoundary>
);

// Hito 4.2.5 — Hook de actualizacion silenciosa con prompt al usuario.
// Cuando el SW reporta una nueva version, emitimos un CustomEvent que
// PwaUpdatePrompt escucha para mostrar el toast.
const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(
      new CustomEvent("sw-update-available", { detail: { updateSW } })
    );
  },
  onOfflineReady() {
    // No-op: el SW ya esta listo para servir offline.
  },
});
