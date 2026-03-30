import { useState, useEffect, useRef } from 'react';
import { Bell, Package, Trash2 } from 'lucide-react';
import { getNotifications, markNotificationRead, deleteAllNotifications } from '@/services/api';
import type { NotificationDTO } from '@/services/api';
import { useApp } from '@/context/AppContext';

export default function IOSNotificationBell() {
  const { role } = useApp();
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (role !== 'CLIENT') return;
    getNotifications().then(setNotifications).catch(() => {});
  }, [role]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setNotifications(prev => [detail, ...prev]);
      }
    };
    window.addEventListener('notification:new:received', handler);
    return () => window.removeEventListener('notification:new:received', handler);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (role !== 'CLIENT') return null;

  const handleRead = async (id: number) => {
    await markNotificationRead(id).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleClearAll = async () => {
    await deleteAllNotifications().catch(() => {});
    setNotifications([]);
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full transition-colors hover:bg-white/30 active:scale-95"
      >
        <Bell className="w-[22px] h-[22px] text-[var(--ios-blue)]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[var(--ios-red)] text-white text-[11px] font-bold rounded-full flex items-center justify-center px-1 animate-bounce-in">
            {unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[320px] glass-ultra rounded-[18px] overflow-hidden animate-scale-in z-50 shadow-lg shadow-black/10">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">Notificaciones</span>
              {unread > 0 && (
                <span className="ios-badge-blue ios-badge text-[11px]">{unread}</span>
              )}
            </div>
            {notifications.length > 0 && (
              <button onClick={handleClearAll} className="p-1.5 hover:bg-black/5 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4 text-[var(--ios-text-tertiary)]" />
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="ios-empty py-8">
                <Bell className="w-8 h-8" />
                <p className="text-[13px]">Sin notificaciones</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleRead(n.id)}
                  className={`
                    w-full text-left flex items-start gap-3 px-4 py-3 transition-colors
                    ${!n.read ? 'bg-[var(--ios-blue)]/[0.04]' : ''}
                    hover:bg-black/[0.03] active:bg-black/[0.06]
                  `}
                >
                  <div className={`
                    ios-icon-circle flex-shrink-0 mt-0.5
                    ${!n.read ? 'bg-[var(--ios-blue)]/10' : 'bg-[var(--ios-separator)]'}
                  `}>
                    <Package className={`w-4 h-4 ${!n.read ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-tertiary)]'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] leading-tight ${!n.read ? 'font-semibold' : ''}`}>
                      {n.title}
                    </p>
                    <p className="text-[13px] text-[var(--ios-text-secondary)] mt-0.5 whitespace-pre-wrap line-clamp-2">
                      {n.message}
                    </p>
                    <p className="text-[11px] text-[var(--ios-text-tertiary)] mt-1">
                      {formatTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-[var(--ios-blue)] flex-shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
