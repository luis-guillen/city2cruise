import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "leaflet/dist/leaflet.css";
import "./index.css";
import "./i18n";
import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")!).render(<App />);

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
