import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import { AccessibilityProvider } from "@/context/AccessibilityContext";
import LoginPage from "@/pages/LoginPage";
import ClientDashboard from "@/pages/ClientDashboard";
import DriverDashboard from "@/pages/DriverDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="top-center" />
      <AccessibilityProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/client" element={
                <ProtectedRoute allowedRoles={["CLIENT"]}>
                  <ClientDashboard />
                </ProtectedRoute>
              } />
              <Route path="/driver" element={
                <ProtectedRoute allowedRoles={["DRIVER"]}>
                  <DriverDashboard />
                </ProtectedRoute>
              } />
              <Route path="/admin" element={
                <ProtectedRoute allowedRoles={["ADMIN"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              } />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </AccessibilityProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
