const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-surface-2 text-muted-foreground",
  pending_approval: "bg-warning/15 text-warning",
  generation_partial: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${
        STATUS_TONE[status] ?? "bg-surface-2 text-muted-foreground"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
