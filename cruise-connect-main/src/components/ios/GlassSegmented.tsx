interface SegmentItem {
  id: string;
  label: string;
}

interface GlassSegmentedProps {
  items: SegmentItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export default function GlassSegmented({ items, active, onChange, className = '' }: GlassSegmentedProps) {
  return (
    <div className={`ios-segmented ${className}`}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`ios-segmented-item ${active === item.id ? 'active' : ''}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
