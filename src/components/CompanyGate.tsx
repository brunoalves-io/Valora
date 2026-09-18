import { useState, type FormEvent, type ReactNode } from "react";
import { useCompany } from "../contexts/CompanyContext";

export function CompanyGate({ children }: { children: ReactNode }) {
  const { activeCompany, companies, createCompany, loading, selectCompany } = useCompany();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) return <div className="center-screen">Carregando empresas...</div>;
  if (activeCompany) return <>{children}</>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createCompany(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a empresa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="company-gate">
      <div className="company-card">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Valora</strong>
            <span>Seu espaço empresarial</span>
          </div>
        </div>

        {companies.length > 0 ? (
          <>
            <p className="eyebrow">SELECIONE UMA EMPRESA</p>
            <h1>Onde vamos trabalhar?</h1>
            <div className="company-list">
              {companies.map(({ company, role }) => (
                <button
                  key={company.id}
                  className="company-option"
                  onClick={() => selectCompany(company.id)}
                >
                  <span className="company-avatar">{company.name.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{company.name}</strong>
                    <small>{role}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">PRIMEIRO ACESSO</p>
            <h1>Crie sua primeira empresa</h1>
            <p>
              Os dados do Valora são organizados por empresa. Você poderá adicionar
              outras depois.
            </p>
            <form onSubmit={submit} className="company-form">
              <label>
                Nome da empresa
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Alves Empreendimentos"
                  autoFocus
                  required
                />
              </label>
              {error && <div className="form-alert error">{error}</div>}
              <button className="primary" disabled={busy}>
                {busy ? "Criando..." : "Criar empresa"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
