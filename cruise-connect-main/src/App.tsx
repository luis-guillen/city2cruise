import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import { AccessibilityProvider } from "@/context/AccessibilityContext";
import LoginPage from "@/pages/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";
import { useTranslation } from "react-i18next";

// Hito 4.2.1 — Code splitting por rol.
// Cada dashboard se carga bajo demanda al navegar a su ruta.
// Esto reduce el bundle inicial y solo descarga el codigo del rol activo.
const ClientDashboard = lazy(() => import("@/pages/ClientDashboard"));
const DriverDashboard = lazy(() => import("@/pages/DriverDashboard"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));

const queryClient = new QueryClient();

function DashboardFallback() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground"
    >
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      <span className="ml-3">{t("common.loading")}</span>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="top-center" />
      <AccessibilityProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route
                path="/client"
                element={
                  <ProtectedRoute allowedRoles={["CLIENT"]}>
                    <Suspense fallback={<DashboardFallback />}>
                      <ClientDashboard />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/driver"
                element={
                  <ProtectedRoute allowedRoles={["DRIVER"]}>
                    <Suspense fallback={<DashboardFallback />}>
                      <DriverDashboard />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={["ADMIN"]}>
                    <Suspense fallback={<DashboardFallback />}>
                      <AdminDashboard />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </AccessibilityProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
