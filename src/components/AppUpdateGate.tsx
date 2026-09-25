import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

type UpdateCheckResult = {
  enabled: boolean;
  currentVersion: string;
  available: boolean;
  version: string | null;
};

export function AppUpdateGate({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const timer = window.setTimeout(() => {
      void invoke<UpdateCheckResult>("check_for_update")
        .then((result) => {
          if (active && result.enabled && result.available) {
            setUpdate(result);
          }
        })
        .catch(() => {
          // Update checks must never block normal use of Valora.
        });
    }, 2200);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function install() {
    if (installing) return;

    setInstalling(true);
    setError("");

    try {
      await invoke("install_update");
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : String(installError || "Não foi possível instalar a atualização."),
      );
      setInstalling(false);
    }
  }

  return (
    <>
      {children}

      {update && (
        <div className="app-update-backdrop" role="presentation">
          <section
            className="app-update-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-update-title"
          >
            <div className="app-update-icon" aria-hidden="true">
              ↑
            </div>

            <div className="app-update-copy">
              <span>ATUALIZAÇÃO DO VALORA</span>
              <h2 id="app-update-title">Nova versão disponível</h2>
              <p>
                {update.version
                  ? `A versão ${update.version} está pronta para instalar.`
                  : "Uma nova versão do Valora está pronta para instalar."}
              </p>
              <small>
                Versão atual: {update.currentVersion}. A atualização é baixada e
                verificada antes da instalação.
              </small>
            </div>

            {error && <div className="app-update-error">{error}</div>}

            <div className="app-update-actions">
              <button
                type="button"
                className="app-update-later"
                onClick={() => setUpdate(null)}
                disabled={installing}
              >
                Agora não
              </button>
              <button
                type="button"
                className="app-update-install"
                onClick={() => void install()}
                disabled={installing}
              >
                {installing ? "Preparando atualização..." : "Atualizar Valora"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
