import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { PickupRequest } from "@/services/api";
import { getClientMine, getPendingRequests, getDriverPickups } from "@/services/api";

type Role = "CLIENT" | "DRIVER" | "ADMIN" | null;

interface AppState {
  userName: string;
  role: Role;
  token: string | null;
  setUser: (name: string, role: Role, token: string, homeCoords?: { lat: number; lon: number } | null) => void;
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
  const [userName, setUserName] = useState(sessionStorage.getItem('userName') || "");
  const [role, setRole] = useState<Role>(sessionStorage.getItem('role') as Role || null);
  const [token, setToken] = useState<string | null>(sessionStorage.getItem('token'));

  const [currentRequest, setCurrentRequest] = useState<PickupRequest | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PickupRequest[]>([]);
  const [driverPickups, setDriverPickups] = useState<PickupRequest[]>([]);
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | null>(() => {
    const stored = sessionStorage.getItem('homeCoords');
    return stored ? JSON.parse(stored) : null;
  });

  const setUser = (name: string, r: Role, t: string, hc?: { lat: number; lon: number } | null) => {
    setUserName(name);
    setRole(r);
    setToken(t);
    sessionStorage.setItem('userName', name);
    sessionStorage.setItem('role', r || '');
    sessionStorage.setItem('token', t);
    if (hc) {
      setHomeCoords(hc);
      sessionStorage.setItem('homeCoords', JSON.stringify(hc));
    }
  };

  const logout = () => {
    setUserName("");
    setRole(null);
    setToken(null);
    setCurrentRequest(null);
    setPendingRequests([]);
    setDriverPickups([]);
    setHomeCoords(null);
    sessionStorage.clear();
  };

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
    } catch (err: any) {
      console.error("Error refreshing data:", err);
      if (err.response?.status === 401) {
        logout();
      }
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
