import { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface GlassTabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

export default function GlassTabBar({ tabs, active, onChange }: GlassTabBarProps) {
  return (
    <div className="ios-tabbar">
      <div className="max-w-lg mx-auto flex items-center justify-around h-full px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              flex flex-col items-center justify-center gap-0.5 px-3 py-1
              transition-all duration-200 relative
              ${active === tab.id
                ? 'text-[var(--ios-blue)]'
                : 'text-[var(--ios-text-tertiary)]'
              }
            `}
          >
            <div className="relative">
              <div className={`w-6 h-6 ${active === tab.id ? 'scale-110' : ''} transition-transform duration-200`}>
                {tab.icon}
              </div>
              {tab.badge && tab.badge > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] rounded-full bg-[var(--ios-red)] text-white text-[11px] font-bold flex items-center justify-center px-1">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{tab.label}</span>

            {/* Active indicator glow */}
            {active === tab.id && (
              <div className="absolute -top-1 w-8 h-1 rounded-full bg-[var(--ios-blue)] opacity-40 blur-sm" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
