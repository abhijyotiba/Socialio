import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standard hairline-bordered surface for the dark theme.
 * `hover` adds the border-brighten + faint accent glow on hover.
 * `tone="2"` uses the higher surface (modals/popovers).
 */
function Panel({
  className,
  hover = false,
  tone = "1",
  ...props
}: React.ComponentProps<"div"> & { hover?: boolean; tone?: "1" | "2" }) {
  return (
    <div
      data-slot="panel"
      className={cn(
        tone === "2" ? "panel-2" : "panel",
        hover && "panel-hover",
        className
      )}
      {...props}
    />
  );
}

export { Panel };
