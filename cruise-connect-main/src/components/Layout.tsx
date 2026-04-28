import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Navbar from "@/components/Navbar";

/**
 * Layout principal autenticado.
 * Hito 4.1.2 (a11y) + Hito 4.1.6 (i18n).
 */
export default function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[1000] focus-visible:rounded-md focus-visible:bg-foreground focus-visible:px-3 focus-visible:py-2 focus-visible:text-background focus-visible:shadow-lg"
      >
        {t("a11y.skipToContent")}
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
        {t("footer.copyright")}
      </footer>
    </div>
  );
}
