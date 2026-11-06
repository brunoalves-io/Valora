// TypeScript · useDialogFocus.ts · React/Tauri · Windows · TypeScript 5
import { useEffect, useRef } from "react";

/** Keeps keyboard focus inside the topmost dialog and restores its trigger. */
export function useDialogFocus(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const visibleControls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(selector) ?? [])
      .filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'));
    const isTopmost = () => {
      const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"]'));
      return dialogs.at(-1) === ref.current;
    };
    const frame = requestAnimationFrame(() => {
      if (!ref.current || !isTopmost() || ref.current.contains(document.activeElement)) return;
      (visibleControls()[0] ?? ref.current).focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopmost()) return;
      const controls = visibleControls();
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); ref.current?.focus(); return; }
      if (!ref.current?.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return ref;
}
