import * as React from "react";
import { cn } from "@/lib/utils";

/** Uppercase, letter-spaced tertiary label (e.g. "ACTIVE INSTANCES"). */
function MicroLabel({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("micro-label", className)} {...props} />;
}

export { MicroLabel };
