import { Outlet } from "react-router-dom";
import Navbar from "@/components/Navbar";

/**
 * Layout principal autenticado.
 *
 * A11y (Hito 4.1.2):
 *  - Skip-link "Saltar al contenido principal" para usuarios de teclado y SR.
 *  - <main id="main"> referenciado por el skip-link.
 *  - <header>/<main>/<footer> son landmarks implícitos.
 *  - Focus visible global definido en index.css (clase .focus-ring).
 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[1000] focus-visible:rounded-md focus-visible:bg-foreground focus-visible:px-3 focus-visible:py-2 focus-visible:text-background focus-visible:shadow-lg"
      >
        Saltar al contenido principal
      </a>
      <Navbar />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 focus:outline-none"
      >
        <Outlet />
      </main>
      <footer
        role="contentinfo"
        className="border-t border-border py-4 text-center text-xs text-muted-foreground"
      >
        © 2026 City2Cruise Las Palmas — Smart Port Logistics
      </footer>
    </div>
  );
}
