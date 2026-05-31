"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandStep } from "./_components/BrandStep";
import { ConnectStep } from "./_components/ConnectStep";
import { TestPostStep } from "./_components/TestPostStep";

const STEPS = [
  { title: "Set up your brand", description: "Tell us about your brand so the AI writes in your voice." },
  { title: "Connect an account", description: "Link LinkedIn to enable publishing from SocialOS." },
  { title: "You're ready", description: "Review your setup and head to the dashboard." },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step
                  ? "bg-accent"
                  : "bg-surface-2"
              }`}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{current.title}</CardTitle>
            <CardDescription>{current.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {step === 0 && <BrandStep onComplete={() => setStep(1)} />}
            {step === 1 && <ConnectStep onComplete={() => setStep(2)} />}
            {step === 2 && <TestPostStep />}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-faint-foreground">
          Step <span className="mono-num">{step + 1}</span> of <span className="mono-num">{STEPS.length}</span>
        </p>
      </div>
    </div>
  );
}
