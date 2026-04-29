import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { PickupRequest } from "@/services/api";
import { getClientMine, getPendingRequests, getDriverPickups, logoutUser } from "@/services/api";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ensureDeviceSigningIdentity } from "@/services/custodyClient";

type Role = "CLIENT" | "DRIVER" | "ADMIN" | null;

interface AppState {
  userId: number | null;
  userName: string;
  role: Role;
  token: string | null;
  setUser: (id: number, name: string, role: Role, token: string, homeCoords?: { lat: number; lon: number } | null) => void;
  logout: () => void;
  currentRequest: PickupRequest | null;
  setCurrentRequest: React.Dispatch<React.SetStateAction<PickupRequest | null>>;
  pendingRequests: PickupRequest[];
  setPendingRequests: React.Dispatch<React.SetStateAction<PickupRequest[]>>;
  driverPickups: PickupRequest[];
  setDriverPickups: React.Dispatch<React.SetStateAction<PickupRequest[]>>;
  refreshData: () => Promise<void>;
  homeCoords: { lat: number; lon: number } | null;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<number | null>(() => {
    const raw = localStorage.getItem('userId');
    return raw ? Number(raw) : null;
  });
  const [userName, setUserName] = useState(localStorage.getItem('userName') || "");
  const [role, setRole] = useState<Role>(localStorage.getItem('role') as Role || null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  const [currentRequest, setCurrentRequest] = useState<PickupRequest | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PickupRequest[]>([]);
  const [driverPickups, setDriverPickups] = useState<PickupRequest[]>([]);
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | null>(() => {
    const stored = localStorage.getItem('homeCoords');
    return stored ? JSON.parse(stored) : null;
  });

  const clearLocalState = useCallback(() => {
    setUserName("");
    setUserId(null);
    setRole(null);
    setToken(null);
    setCurrentRequest(null);
    setPendingRequests([]);
    setDriverPickups([]);
    setHomeCoords(null);
    localStorage.removeItem('token');
    localStorage.removeItem('userName');
    localStorage.removeItem('userId');
    localStorage.removeItem('role');
    localStorage.removeItem('homeCoords');
  }, []);

  const setUser = (id: number, name: string, r: Role, t: string, hc?: { lat: number; lon: number } | null) => {
    setUserId(id);
    setUserName(name);
    setRole(r);
    setToken(t);
    localStorage.setItem('userName', name);
    localStorage.setItem('userId', String(id));
    localStorage.setItem('role', r || '');
    localStorage.setItem('token', t);
    if (hc) {
      setHomeCoords(hc);
      localStorage.setItem('homeCoords', JSON.stringify(hc));
    }
  };

  const logout = useCallback(async () => {
    await logoutUser();
    clearLocalState();
  }, [clearLocalState]);

  // El interceptor de Axios dispara este evento cuando el refresh falla
  useEffect(() => {
    const handler = () => clearLocalState();
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, [clearLocalState]);

  const { syncSubscription } = usePushNotifications();

  // Re-register existing VAPID subscription silently on every login
  useEffect(() => {
    if (token) syncSubscription();
  }, [token, syncSubscription]);

  useEffect(() => {
    if (!token || !userId) return;
    ensureDeviceSigningIdentity(userId).catch((err) => {
      console.error('Error ensuring signing identity:', err);
    });
  }, [token, userId]);

  const refreshData = useCallback(async () => {
    if (!token) return;

    try {
      if (role === 'CLIENT') {
        const req = await getClientMine();
        setCurrentRequest(req);
      } else if (role === 'DRIVER') {
        const pending = await getPendingRequests();
        setPendingRequests(pending);
        const myPickups = await getDriverPickups();
        setDriverPickups(myPickups);
      }
    } catch (err) {
      console.error("Error refreshing data:", err);
      // El interceptor ya maneja el 401 → auth:logout
    }
  }, [token, role]);

  useEffect(() => {
    if (token) {
      refreshData();
    }
  }, [token, role, refreshData]);

  return (
    <AppContext.Provider
      value={{
        userName,
        userId,
        role,
        token,
        setUser,
        logout,
        currentRequest,
        setCurrentRequest,
        pendingRequests,
        setPendingRequests,
        driverPickups,
        setDriverPickups,
        refreshData,
        homeCoords
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
