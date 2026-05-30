import * as React from "react";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { MicroLabel } from "@/components/ui/micro-label";

/**
 * Metric tile: micro-label + oversized mono number + optional accessory
 * (icon, sparkline). Presentational only.
 */
function Stat({
  label,
  value,
  sub,
  accessory,
  accent = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accessory?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Panel hover className={cn("relative overflow-hidden p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {accessory}
      </div>
      <p
        className={cn(
          "mono-num mt-3 text-4xl font-bold leading-none",
          accent ? "text-accent" : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-3 text-[11px] text-muted-foreground">{sub}</div>}
    </Panel>
  );
}

export { Stat };
