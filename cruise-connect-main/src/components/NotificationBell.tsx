import { useState, useEffect, useRef } from "react";
import { Bell, CircleAlert, Package, Trash2 } from "lucide-react";
import {
  getNotifications,
  markNotificationRead,
  deleteAllNotifications,
  NotificationDTO,
} from "@/services/api";
import { useSocket } from "@/hooks/useSocket";
import { format } from "date-fns";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";

/**
 * Campana de notificaciones del cliente.
 *
 * A11y (Hito 4.1.2):
 *  - Botón con type="button", aria-label dinámico (incluye contador no leídos),
 *    aria-expanded y aria-controls.
 *  - Popup como role="dialog" + aria-labelledby + aria-modal="false".
 *  - aria-live="polite" en la lista para que lectores anuncien nuevas notifs.
 *  - Tecla Escape cierra el popup, foco vuelve al botón.
 *  - Cada item es <button> en lugar de <div onClick> para keyboard.
 *  - Tap target mínimo 44x44.
 */
export default function NotificationBell() {
  const { role } = useApp();
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useSocket();

  useEffect(() => {
    if (role === "CLIENT") loadNotifications();
  }, [role]);

  const loadNotifications = async () => {
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error("Failed to load notifications", err);
    }
  };

  useEffect(() => {
    const handleNewNotif = (e: CustomEvent<NotificationDTO>) => {
      setNotifications((prev) => [e.detail, ...prev]);
      toast.success(e.detail.title, { description: e.detail.message });
    };
    window.addEventListener(
      "notification:new:received",
      handleNewNotif as EventListener
    );
    return () =>
      window.removeEventListener(
        "notification:new:received",
        handleNewNotif as EventListener
      );
  }, []);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Cerrar con Escape y devolver foco al botón
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAll = async () => {
    try {
      await deleteAllNotifications();
      setNotifications([]);
      toast.success("Notificaciones borradas");
    } catch (err) {
      console.error(err);
      toast.error("Error al borrar notificaciones");
    }
  };

  if (role !== "CLIENT") return null;

  const unreadCount = notifications.filter((n) => !n.read).length;
  const labelBase = "Notificaciones";
  const ariaLabel =
    unreadCount > 0
      ? `${labelBase}, ${unreadCount} sin leer`
      : `${labelBase}, sin novedades`;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="notification-popover"
        aria-label={ariaLabel}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Bell className="h-5 w-5" aria-hidden="true" focusable="false" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-popover"
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="notification-popover-title"
          className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
            <h3
              id="notification-popover-title"
              className="font-semibold text-sm"
            >
              Notificaciones
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {unreadCount} nuevas
              </span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  aria-label="Borrar todas las notificaciones"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive min-h-[36px]"
                  title="Borrar todas"
                >
                  <Trash2
                    className="h-3 w-3"
                    aria-hidden="true"
                    focusable="false"
                  />
                  Borrar
                </button>
              )}
            </div>
          </div>

          <div
            className="max-h-[300px] overflow-y-auto"
            aria-live="polite"
            aria-relevant="additions"
          >
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <CircleAlert
                  className="h-8 w-8 mb-2 opacity-20"
                  aria-hidden="true"
                  focusable="false"
                />
                <p className="text-sm">No tienes notificaciones</p>
              </div>
            ) : (
              <ul className="flex flex-col" role="list">
                {notifications.map((n) => {
                  const isUnread = !n.read;
                  const itemLabel = `${isUnread ? "Sin leer: " : ""}${n.title}. ${n.message}`;
                  return (
                    <li key={n.id} className="border-b border-border last:border-0">
                      <button
                        type="button"
                        onClick={() => isUnread && handleMarkRead(n.id)}
                        aria-label={itemLabel}
                        className={`flex w-full items-start gap-3 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          isUnread
                            ? "bg-accent/5 hover:bg-accent/10"
                            : "bg-transparent hover:bg-muted/40"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 rounded-full p-1.5 ${
                            isUnread
                              ? "bg-accent/20 text-accent"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <Package className="h-4 w-4" />
                        </span>
                        <span className="flex-1 space-y-1 truncate">
                          <span
                            className={`block text-sm ${
                              isUnread
                                ? "font-semibold text-foreground"
                                : "font-medium text-foreground"
                            }`}
                          >
                            {n.title}
                          </span>
                          <span className="block text-xs text-muted-foreground whitespace-pre-wrap">
                            {n.message}
                          </span>
                          <span className="block text-[10px] text-muted-foreground/80 mt-1">
                            {format(new Date(n.createdAt), "dd MMM HH:mm")}
                          </span>
                        </span>
                        {isUnread && (
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full bg-accent shrink-0 mt-1.5"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
