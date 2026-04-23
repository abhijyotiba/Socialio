"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function TestPostStep() {
  const router = useRouter();

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <p className="text-2xl">🎉</p>
        <p className="font-semibold text-zinc-900 dark:text-zinc-50">
          You&apos;re all set!
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your brand is configured. AI post generation is coming in the next
          phase — head to the dashboard to get started.
        </p>
      </div>

      <Button className="w-full" onClick={() => router.push("/dashboard")}>
        Go to dashboard
      </Button>
    </div>
  );
}
