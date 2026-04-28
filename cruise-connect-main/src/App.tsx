import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import LoginPage from "@/pages/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";

// Heavy dashboards — loaded only when the user navigates to their route
const ClientDashboard = lazy(() => import("@/pages/ClientDashboard"));
const DriverDashboard = lazy(() => import("@/pages/DriverDashboard"));
const AdminDashboard  = lazy(() => import("@/pages/AdminDashboard"));

// Inline skeleton so Suspense never flashes a blank screen
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--ios-bg,#F2F2F7)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[var(--ios-blue,#007AFF)]/20 border-t-[var(--ios-blue,#007AFF)] animate-spin" />
        <p className="text-sm text-gray-400 font-medium">Cargando…</p>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Requests and driver positions update via WebSocket → 30s is fine as refetch floor
      staleTime: 30_000,
      // Keep inactive cache entries for 5 min before GC
      gcTime: 5 * 60 * 1000,
      // Avoid refetch storms on window focus (WS keeps data fresh)
      refetchOnWindowFocus: false,
      // One retry on transient network errors; fail fast otherwise
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="top-center" />
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route path="/client" element={
              <ProtectedRoute allowedRoles={["CLIENT"]}>
                <Suspense fallback={<DashboardSkeleton />}>
                  <ClientDashboard />
                </Suspense>
              </ProtectedRoute>
            } />
            <Route path="/driver" element={
              <ProtectedRoute allowedRoles={["DRIVER"]}>
                <Suspense fallback={<DashboardSkeleton />}>
                  <DriverDashboard />
                </Suspense>
              </ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute allowedRoles={["ADMIN"]}>
                <Suspense fallback={<DashboardSkeleton />}>
                  <AdminDashboard />
                </Suspense>
              </ProtectedRoute>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
