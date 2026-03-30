import type { PickupRequest } from "@/services/api";

const statusConfig: Record<
  PickupRequest["status"],
  { label: string; className: string }
> = {
  REQUESTED: {
    label: "Solicitado",
    className: "bg-status-requested text-status-requested-foreground",
  },
  ACCEPTED: {
    label: "Aceptado",
    className: "bg-status-accepted text-status-accepted-foreground",
  },
  CONFIRMATION_PENDING: {
    label: "En encuentro",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  IN_PROGRESS: {
    label: "En traslado",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  DEPOSITED: {
    label: "Depositado",
    className: "bg-status-deposited text-status-deposited-foreground",
  },
  PICKED_UP: {
    label: "Recogido",
    className: "bg-status-picked-up text-status-picked-up-foreground",
  },
};

export default function StatusBadge({ status }: { status: PickupRequest["status"] }) {
  const cfg = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
