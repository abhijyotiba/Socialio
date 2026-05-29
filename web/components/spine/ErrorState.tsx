type Props = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorState({ message, onRetry, onDismiss }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-xs text-red-600">{message}</p>
      <div className="flex shrink-0 items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] font-semibold text-red-700 hover:underline"
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
