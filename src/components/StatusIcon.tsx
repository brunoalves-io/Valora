// TSX · StatusIcon.tsx · shared status vector · Windows/WebView2 · React/TypeScript
type StatusIconProps = { kind: "attention" | "check" | "info"; className?: string };

/** Decorative status symbol; the adjacent title supplies its accessible meaning. */
export function StatusIcon({ kind, className }: StatusIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "attention" ? (
        <>
          <path d="M10.3 4.4a2 2 0 0 1 3.4 0l7.2 12.5A2 2 0 0 1 19.2 20H4.8a2 2 0 0 1-1.7-3.1Z" />
          <path d="M12 9v4M12 16h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          {kind === "check" ? <path d="m8 12 2.5 2.5L16 9" /> : <path d="M12 11v5M12 8h.01" />}
        </>
      )}
    </svg>
  );
}
