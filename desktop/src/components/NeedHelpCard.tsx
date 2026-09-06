import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";

/**
 * Floating "Need help?" assistant prompt.
 * Bottom-right card that appears on non-chat pages, dismissible,
 * and opens the AI chat on click.
 */
export function NeedHelpCard({ onOpen }: { onOpen: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    // Session-scoped dismissal (memory only; project bans localStorage)
    return (window as unknown as { __needHelpDismissed?: boolean }).__needHelpDismissed === true;
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="complementary"
      aria-label="Need help assistant prompt"
      className={[
        "fixed bottom-5 right-5 z-40 w-[240px] rounded-2xl border border-[var(--border)]",
        "bg-[#0B1526] p-4 shadow-2xl transition-all duration-500",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          (window as unknown as { __needHelpDismissed?: boolean }).__needHelpDismissed = true;
          setDismissed(true);
        }}
        className="absolute right-2.5 top-2.5 rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
      >
        <svg viewBox="0 0 20 20" fill="none" className="size-3.5" stroke="currentColor" strokeWidth="2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
          {/* Bot icon */}
          <svg viewBox="0 0 24 24" fill="none" className="size-6 text-white" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 8V5m0 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" strokeLinecap="round" />
            <circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none" />
            <path d="M9.5 17h5" strokeLinecap="round" />
          </svg>
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Need help?</div>
          <div className="mt-0.5 text-xs text-slate-400">Ask our AI assistant</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-3.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0B1526] shadow-md transition hover:bg-blue-50 active:scale-[0.98]"
      >
        <MessageSquareText className="size-4" />
        Open Chat
      </button>
    </div>
  );
}
