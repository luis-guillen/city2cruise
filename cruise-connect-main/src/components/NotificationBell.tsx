import { useState, useEffect, useRef } from "react";
import { Bell, CircleAlert, Package, Trash2 } from "lucide-react";
import { getNotifications, markNotificationRead, deleteAllNotifications, NotificationDTO } from "@/services/api";
import { useSocket } from "@/hooks/useSocket";
import { format } from "date-fns";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";

export default function NotificationBell() {
    const { role } = useApp();
    const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useSocket(); // maintain connection

    useEffect(() => {
        if (role === 'CLIENT') {
            loadNotifications();
        }
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
            setNotifications(prev => [e.detail, ...prev]);
            toast.success(e.detail.title, { description: e.detail.message });
        };

        window.addEventListener("notification:new:received", handleNewNotif as EventListener);
        return () => window.removeEventListener("notification:new:received", handleNewNotif as EventListener);
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleMarkRead = async (id: number) => {
        try {
            await markNotificationRead(id);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
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

    if (role !== 'CLIENT') return null;

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div className="relative" ref={wrapperRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                        <h3 className="font-semibold text-sm">Notificaciones</h3>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{unreadCount} nuevas</span>
                            {notifications.length > 0 && (
                                <button
                                    onClick={handleClearAll}
                                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Borrar todas"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    Borrar
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="max-h-[300px] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                                <CircleAlert className="h-8 w-8 mb-2 opacity-20" />
                                <p className="text-sm">No tienes notificaciones</p>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {notifications.map((n) => (
                                    <div
                                        key={n.id}
                                        onClick={() => {
                                            if (!n.read) handleMarkRead(n.id);
                                        }}
                                        className={`flex items-start gap-3 border-b border-border p-4 transition-colors last:border-0 ${!n.read ? 'bg-accent/5 cursor-pointer hover:bg-accent/10' : 'bg-transparent'}`}
                                    >
                                        <div className={`mt-0.5 rounded-full p-1.5 ${!n.read ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}>
                                            <Package className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 space-y-1 truncate">
                                            <p className={`text-sm ${!n.read ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                                {n.title}
                                            </p>
                                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                                {n.message}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground/80 mt-1">
                                                {format(new Date(n.createdAt), "dd MMM HH:mm")}
                                            </p>
                                        </div>
                                        {!n.read && (
                                            <div className="h-2 w-2 rounded-full bg-accent shrink-0 mt-1.5" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
