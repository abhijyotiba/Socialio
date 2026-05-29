const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-50 text-amber-700",
  generation_partial: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${
        STATUS_TONE[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
