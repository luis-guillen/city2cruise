import { Package, LogOut } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import NotificationBell from "./NotificationBell";

export default function Navbar() {
  const { userName, role, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-accent" />
          <span className="font-display text-lg font-bold tracking-tight text-foreground">
            City2Cruise <span className="text-accent">LPA</span>
          </span>
        </div>

        {role && (
          <div className="flex items-center gap-4">
            <NotificationBell />
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {userName} · <span className="font-medium text-foreground">{role}</span>
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
