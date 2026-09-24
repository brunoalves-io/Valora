import { useState, type FormEvent, type ReactNode } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type AccountKind = "cash" | "checking" | "savings" | "wallet" | "other";

const roleLabels = {
  owner: "Líder",
  admin: "Administrador",
  member: "Membro",
  viewer: "Visualizador",
} as const;

const accountKindLabels: Record<AccountKind, string> = {
  cash: "Caixa",
  checking: "Conta corrente",
  savings: "Poupança",
  wallet: "Carteira",
  other: "Outra",
};

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatTaxId(value: string) {
  const clean = digits(value).slice(0, 14);

  if (clean.length <= 11) {
    return clean
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  return clean
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatPhone(value: string) {
  const clean = digits(value).slice(0, 11);
  if (clean.length <= 10) {
    return clean
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  return clean
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  if (clean.includes(",")) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }
  return Number(clean);
}

function nullable(value: string) {
  const clean = value.trim();
  return clean || null;
}

export function CompanyGate({ children }: { children: ReactNode }) {
  const { activeCompany, companies, createCompany, loading, refreshCompanies, selectCompany } =
    useCompany();

  const [step, setStep] = useState(1);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [companyForm, setCompanyForm] = useState({
    name: "",
    legal_name: "",
    tax_id: "",
    email: "",
    phone: "",
  });

  const [accountForm, setAccountForm] = useState({
    name: "Conta principal",
    kind: "checking" as AccountKind,
    opening_balance: "0,00",
  });

  if (loading && !onboardingActive) {
    return <div className="center-screen">Carregando empresas...</div>;
  }

  if (activeCompany && !onboardingActive) return <>{children}</>;

  function nextCompanyStep(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (companyForm.name.trim().length < 2) {
      setError("Informe um nome válido para a empresa.");
      return;
    }

    const taxLength = digits(companyForm.tax_id).length;
    if (companyForm.tax_id.trim() && taxLength !== 11 && taxLength !== 14) {
      setError("O CPF/CNPJ deve ter 11 ou 14 dígitos.");
      return;
    }

    setStep(2);
  }

  function nextAccountStep(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (accountForm.name.trim().length < 2) {
      setError("Informe um nome para a primeira conta.");
      return;
    }

    const openingBalance = parseMoney(accountForm.opening_balance);
    if (!Number.isFinite(openingBalance)) {
      setError("Informe um saldo inicial válido.");
      return;
    }

    setStep(3);
  }

  async function finishOnboarding() {
    if (!supabase || busy) return;

    setBusy(true);
    setOnboardingActive(true);
    setError("");

    try {
      let companyId = createdCompanyId;

      if (!companyId) {
        companyId = await createCompany(companyForm.name);
        setCreatedCompanyId(companyId);
      }

      const openingBalance = parseMoney(accountForm.opening_balance);

      const { error: companyError } = await supabase
        .from("companies")
        .update({
          legal_name: nullable(companyForm.legal_name),
          tax_id: nullable(companyForm.tax_id),
          email: nullable(companyForm.email),
          phone: nullable(companyForm.phone),
          updated_at: new Date().toISOString(),
        })
        .eq("id", companyId);

      if (companyError) throw companyError;

      const { data: existingAccounts, error: existingAccountError } = await supabase
        .from("financial_accounts")
        .select("id")
        .eq("company_id", companyId)
        .limit(1);

      if (existingAccountError) throw existingAccountError;

      if ((existingAccounts ?? []).length === 0) {
        const { error: accountError } = await supabase
          .from("financial_accounts")
          .insert({
            company_id: companyId,
            name: accountForm.name.trim(),
            kind: accountForm.kind,
            opening_balance: openingBalance,
          });

        if (accountError) throw accountError;
      }

      await refreshCompanies();
      setOnboardingActive(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a configuração inicial.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (companies.length > 0 && !onboardingActive && !activeCompany) {
    return (
      <div className="company-gate">
        <div className="company-card">
          <div className="brand">
            <div className="brand-mark">
            <img src="/valora-logo.png" alt="" aria-hidden="true" />
          </div>
            <div>
              <strong>Valora</strong>
              <span>Seu espaço empresarial</span>
            </div>
          </div>

          <p className="eyebrow">SELECIONE UMA EMPRESA</p>
          <h1>Onde vamos trabalhar?</h1>

          <div className="company-list">
            {companies.map(({ company, role }) => (
              <button
                key={company.id}
                className="company-option"
                onClick={() => selectCompany(company.id)}
              >
                <span className="company-avatar">
                  {company.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{company.name}</strong>
                  <small>{roleLabels[role]}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-page">
      <aside className="onboarding-side">
        <div className="brand large">
          <div className="brand-mark">
            <img src="/valora-logo.png" alt="" aria-hidden="true" />
          </div>
          <div>
            <strong>Valora</strong>
            <span>Gestão inteligente</span>
          </div>
        </div>

        <div className="onboarding-side-copy">
          <p className="eyebrow">PRIMEIRO ACESSO</p>
          <h1>Vamos deixar sua empresa pronta.</h1>
          <p>
            Em poucos passos o Valora cria a estrutura mínima para você começar
            com o financeiro organizado desde o primeiro lançamento.
          </p>
        </div>

        <div className="onboarding-trust">
          <span>✓ Seus dados ficam separados por empresa</span>
          <span>✓ Você será o Líder da empresa criada</span>
          <span>✓ Tudo poderá ser ajustado depois</span>
        </div>
      </aside>

      <main className="onboarding-main">
        <div className="onboarding-card">
          <div className="onboarding-progress">
            {[1, 2, 3].map((item) => (
              <div
                className={
                  item < step
                    ? "onboarding-step done"
                    : item === step
                      ? "onboarding-step active"
                      : "onboarding-step"
                }
                key={item}
              >
                <span>{item < step ? "✓" : item}</span>
                <div>
                  <strong>
                    {item === 1 ? "Empresa" : item === 2 ? "Primeira conta" : "Revisão"}
                  </strong>
                  <small>
                    {item === 1
                      ? "Dados básicos"
                      : item === 2
                        ? "Onde começa o caixa"
                        : "Tudo certo"}
                  </small>
                </div>
              </div>
            ))}
          </div>

          {step === 1 && (
            <form className="onboarding-form" onSubmit={nextCompanyStep}>
              <div className="onboarding-heading">
                <p className="eyebrow">ETAPA 1 DE 3</p>
                <h2>Conte um pouco sobre a empresa</h2>
                <p>
                  Só o nome é obrigatório agora. Os demais dados ajudam o Valora a
                  ficar pronto para propostas e relatórios.
                </p>
              </div>

              <div className="onboarding-fields two-columns">
                <label className="wide">
                  Nome no Valora
                  <input
                    value={companyForm.name}
                    onChange={(event) =>
                      setCompanyForm({ ...companyForm, name: event.target.value })
                    }
                    placeholder="Ex.: Alves Empreendimentos"
                    autoFocus
                    required
                  />
                </label>

                <label className="wide">
                  Razão social / nome completo
                  <input
                    value={companyForm.legal_name}
                    onChange={(event) =>
                      setCompanyForm({ ...companyForm, legal_name: event.target.value })
                    }
                    placeholder="Opcional"
                  />
                </label>

                <label>
                  CPF / CNPJ
                  <input
                    value={companyForm.tax_id}
                    onChange={(event) =>
                      setCompanyForm({
                        ...companyForm,
                        tax_id: formatTaxId(event.target.value),
                      })
                    }
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                  />
                </label>

                <label>
                  Telefone
                  <input
                    value={companyForm.phone}
                    onChange={(event) =>
                      setCompanyForm({
                        ...companyForm,
                        phone: formatPhone(event.target.value),
                      })
                    }
                    inputMode="tel"
                    placeholder="(00) 00000-0000"
                  />
                </label>

                <label className="wide">
                  E-mail da empresa
                  <input
                    type="email"
                    value={companyForm.email}
                    onChange={(event) =>
                      setCompanyForm({ ...companyForm, email: event.target.value })
                    }
                    placeholder="financeiro@empresa.com.br"
                  />
                </label>
              </div>

              {error && <div className="form-alert error">{error}</div>}

              <div className="onboarding-actions">
                <span>Você poderá completar endereço e identidade depois.</span>
                <button className="primary">Continuar</button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form className="onboarding-form" onSubmit={nextAccountStep}>
              <div className="onboarding-heading">
                <p className="eyebrow">ETAPA 2 DE 3</p>
                <h2>Crie sua primeira conta financeira</h2>
                <p>
                  Ela será o ponto de partida para calcular saldo, entradas e saídas.
                  Não existe conexão bancária nesta etapa.
                </p>
              </div>

              <div className="onboarding-account-highlight">
                <div className="account-symbol">◉</div>
                <div>
                  <strong>Estrutura financeira inicial</strong>
                  <span>Você poderá criar outras contas e caixas depois.</span>
                </div>
              </div>

              <div className="onboarding-fields">
                <label>
                  Nome da conta
                  <input
                    value={accountForm.name}
                    onChange={(event) =>
                      setAccountForm({ ...accountForm, name: event.target.value })
                    }
                    placeholder="Ex.: Banco principal"
                    autoFocus
                    required
                  />
                </label>

                <label>
                  Tipo
                  <select
                    value={accountForm.kind}
                    onChange={(event) =>
                      setAccountForm({
                        ...accountForm,
                        kind: event.target.value as AccountKind,
                      })
                    }
                  >
                    {Object.entries(accountKindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Saldo inicial
                  <input
                    value={accountForm.opening_balance}
                    onChange={(event) =>
                      setAccountForm({
                        ...accountForm,
                        opening_balance: event.target.value,
                      })
                    }
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                  <small>Informe o saldo que existe nessa conta hoje.</small>
                </label>
              </div>

              {error && <div className="form-alert error">{error}</div>}

              <div className="onboarding-actions split-actions">
                <button type="button" className="ghost" onClick={() => setStep(1)}>
                  Voltar
                </button>
                <button className="primary">Revisar</button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="onboarding-form">
              <div className="onboarding-heading">
                <p className="eyebrow">ETAPA 3 DE 3</p>
                <h2>Pronto para abrir o Valora</h2>
                <p>
                  Confira o resumo. A empresa e a primeira conta serão criadas juntas
                  quando você concluir.
                </p>
              </div>

              <div className="onboarding-review">
                <section>
                  <span>Empresa</span>
                  <strong>{companyForm.name}</strong>
                  <small>
                    {companyForm.tax_id || companyForm.email || "Dados complementares depois"}
                  </small>
                </section>

                <section>
                  <span>Seu papel</span>
                  <strong>Líder</strong>
                  <small>Controle total da empresa e da equipe</small>
                </section>

                <section>
                  <span>Primeira conta</span>
                  <strong>{accountForm.name}</strong>
                  <small>
                    {accountKindLabels[accountForm.kind]} · Saldo inicial{" "}
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(parseMoney(accountForm.opening_balance) || 0)}
                  </small>
                </section>
              </div>

              <div className="onboarding-ready-note">
                <div>✦</div>
                <div>
                  <strong>Depois daqui, o Dashboard já nasce com uma base financeira.</strong>
                  <span>
                    O próximo passo será registrar receitas, despesas ou explorar a Valora IA.
                  </span>
                </div>
              </div>

              {error && <div className="form-alert error">{error}</div>}

              <div className="onboarding-actions split-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setStep(2)}
                  disabled={busy}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className="primary onboarding-finish"
                  onClick={() => void finishOnboarding()}
                  disabled={busy}
                >
                  {busy ? "Preparando sua empresa..." : "Entrar no Valora"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
