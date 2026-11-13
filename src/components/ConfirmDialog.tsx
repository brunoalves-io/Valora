import { useEffect, useRef } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { StatusIcon } from "./StatusIcon";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  warning?: string;
  showWarningIcon?: boolean;
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
  showWarningIcon = true,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busyLabel = "Processando...",
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus(open);
  const interaction = useRef({ busy, onCancel });
  interaction.current = { busy, onCancel };

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement as HTMLElement | null;

    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !interaction.current.busy) {
        event.preventDefault();
        interaction.current.onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      previousActive?.focus?.();
    };
  }, [open]);

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
        ref={dialogRef}
        tabIndex={-1}
        className={"confirm-dialog confirm-dialog--" + tone}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <div className="confirm-dialog-content">
          <div className={"confirm-dialog-icon confirm-dialog-icon--" + tone} aria-hidden="true">
            <StatusIcon kind={tone === "danger" ? "attention" : "check"} />
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
          <div className={"confirm-dialog-warning confirm-dialog-warning--" + tone + (showWarningIcon ? "" : " confirm-dialog-warning--no-icon")}>
            {showWarningIcon && <span aria-hidden="true">i</span>}
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
            className={"confirm-dialog-confirm confirm-dialog-confirm--" + tone}
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
