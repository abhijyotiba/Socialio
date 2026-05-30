type Props = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorState({ message, onRetry, onDismiss }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
      <p className="text-xs text-destructive">{message}</p>
      <div className="flex shrink-0 items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] font-semibold text-destructive hover:underline"
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-faint-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
