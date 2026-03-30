import { ReactNode, useEffect } from 'react';

interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export default function GlassModal({ isOpen, onClose, title, children }: GlassModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg glass-ultra rounded-t-[24px] animate-slide-up max-h-[85dvh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pull indicator */}
        <div className="ios-pull-indicator mt-2" />

        {title && (
          <div className="px-6 pt-4 pb-2">
            <h2 className="text-[22px] font-bold tracking-tight">{title}</h2>
          </div>
        )}

        <div className="px-6 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}
