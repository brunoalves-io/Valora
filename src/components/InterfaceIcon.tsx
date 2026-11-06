// TSX · InterfaceIcon.tsx · decorative interface vectors · Windows/WebView2 · React
type InterfaceIconName = "plus" | "bank" | "link" | "upload" | "sync" | "reconcile" | "rules" | "help";

/** These icons accompany visible labels; they never add focus stops or duplicate names. */
export function InterfaceIcon({ name }: { name: InterfaceIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "bank" && <><path d="m12 3-9 5h18ZM5 11v7m5-7v7m4-7v7m5-7v7M3 21h18" /></>}
      {name === "link" && <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>}
      {name === "upload" && <><path d="M6 3h8l4 4v14H6ZM14 3v5h4M12 17v-6m-3 3 3-3 3 3" /></>}
      {name === "sync" && <><path d="M20 8a8 8 0 0 0-14-2L4 8m0-4v4h4M4 16a8 8 0 0 0 14 2l2-2m0 4v-4h-4" /></>}
      {name === "reconcile" && <><path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" /></>}
      {name === "rules" && <><path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>}
      {name === "help" && <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 16h.01" /></>}
    </svg>
  );
}
