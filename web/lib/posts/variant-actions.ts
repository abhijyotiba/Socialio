export type ActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "loadingSlots" }
  | { kind: "pickingSlot"; nextSlots: string[] }
  | { kind: "pickingTime" }
  | { kind: "scheduling" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const BUSY_KINDS = ["publishing", "loadingSlots", "scheduling", "cancelling"];
const TERMINAL_KINDS = ["published", "scheduled", "cancelled"];

export function isBusy(state: ActionState): boolean {
  return BUSY_KINDS.includes(state.kind);
}

export function isTerminal(state: ActionState): boolean {
  return TERMINAL_KINDS.includes(state.kind);
}

export function showIdleActions(state: ActionState): boolean {
  return (
    !isTerminal(state) &&
    state.kind !== "pickingSlot" &&
    state.kind !== "pickingTime"
  );
}
