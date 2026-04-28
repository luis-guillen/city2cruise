import { Package, LogOut } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import NotificationBell from "./NotificationBell";

/**
 * Navbar superior.
 *
 * A11y (Hito 4.1.2):
 *  - <header role="banner"> + <nav aria-label="...">.
 *  - Botón "Salir" con type="button" explícito y aria-label combinada
 *    con texto visible.
 *  - Iconos decorativos con aria-hidden="true".
 *  - Focus visible respetando prefers-reduced-motion (transition-colors solo).
 */
export default function Navbar() {
  const { userName, role, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Package
            className="h-5 w-5 text-accent"
            aria-hidden="true"
            focusable="false"
          />
          <span className="font-display text-lg font-bold tracking-tight text-foreground">
            City2Cruise <span className="text-accent">LPA</span>
          </span>
        </div>

        {role && (
          <nav
            aria-label="Acciones de usuario"
            className="flex items-center gap-4"
          >
            <NotificationBell />
            <span
              className="text-sm text-muted-foreground hidden sm:inline"
              aria-label={`Sesión iniciada como ${userName}, rol ${role}`}
            >
              {userName} ·{" "}
              <span className="font-medium text-foreground">{role}</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-[40px]"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" focusable="false" />
              Salir
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
