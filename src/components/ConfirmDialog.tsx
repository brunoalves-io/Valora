import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  warning,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busyLabel = "Processando...",
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement as HTMLElement | null;

    document.body.style.overflow = "hidden";
    window.setTimeout(() => cancelRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousActive?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className={"confirm-dialog " + tone}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <div className="confirm-dialog-content">
          <div className={"confirm-dialog-icon " + tone} aria-hidden="true">
            {tone === "danger" ? "!" : "✓"}
          </div>
          <div className="confirm-dialog-copy">
            <span className="confirm-dialog-kicker">
              {tone === "danger" ? "CONFIRMAÇÃO NECESSÁRIA" : "REVISAR E CONFIRMAR"}
            </span>
            <h2 id="confirm-dialog-title">{title}</h2>
            <p id="confirm-dialog-description">{description}</p>
          </div>
        </div>

        {warning && (
          <div className={"confirm-dialog-warning " + tone}>
            <span aria-hidden="true">i</span>
            <p>{warning}</p>
          </div>
        )}

        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-dialog-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={"confirm-dialog-confirm " + tone}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
