"use client";

import { Button } from "@/components/ui/button";

interface ConnectStepProps {
  onComplete: () => void;
}

export function ConnectStep({ onComplete }: ConnectStepProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Connect at least one social account so SocialOS can publish on your behalf.
      </p>

      <div className="flex flex-col gap-3">
        <a href="/api/oauth/linkedin/start">
          <Button className="w-full" variant="outline">
            Connect LinkedIn
          </Button>
        </a>

        <a href="/api/oauth/x/start">
          <Button className="w-full" variant="outline">
            Connect X / Twitter
          </Button>
        </a>
      </div>

      <button
        type="button"
        onClick={onComplete}
        className="w-full text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2 text-center"
      >
        Skip for now
      </button>
    </div>
  );
}
