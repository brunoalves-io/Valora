import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type ProviderConfig = {
  provider: string;
  configured: boolean;
  includeSandbox: boolean;
  transactionWindowDays: number;
};

type BankConnection = {
  id: string;
  company_id: string;
  provider: string;
  provider_item_id: string;
  connector_id: string | null;
  institution_name: string;
  institution_logo_url: string | null;
  institution_primary_color: string | null;
  connection_type: "aggregation" | "open_finance" | "unknown";
  status: "pending" | "active" | "error" | "revoked";
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
};

type ExternalAccount = {
  id: string;
  company_id: string;
  connection_id: string;
  provider_account_id: string;
  name: string;
  account_type: "bank" | "credit" | "other";
  subtype: string | null;
  number_masked: string | null;
  currency_code: string;
  balance: number | null;
  available_balance: number | null;
  local_account_id: string | null;
  updated_at: string;
};

type BankTransaction = {
  id: string;
  external_account_id: string;
  movement_type: "income" | "expense";
  status: "POSTED" | "PENDING" | "UNKNOWN";
  amount: number;
  description: string;
  transaction_date: string;
};

type LocalAccount = {
  id: string;
  name: string;
  active: boolean;
};

type SyncRun = {
  id: string;
  connection_id: string;
  status: "running" | "success" | "error";
  started_at: string;
  finished_at: string | null;
  accounts_synced: number;
  transactions_upserted: number;
  error_message: string | null;
};

type PluggyWidget = {
  init: () => void;
};

type PluggyWidgetOptions = {
  connectToken: string;
  updateItem?: string;
  includeSandbox?: boolean;
  forceOauthInBrowser?: boolean;
  theme?: "light" | "dark";
  onSuccess?: (data: { item?: { id?: string } }) => void | Promise<void>;
  onError?: (error: { message?: string }) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
};

declare global {
  interface Window {
    PluggyConnect?: new (options: PluggyWidgetOptions) => PluggyWidget;
  }
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDateTime(value: string | null) {
  if (!value) return "Ainda não sincronizado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function accountTypeLabel(type: ExternalAccount["account_type"]) {
  if (type === "bank") return "Conta bancária";
  if (type === "credit") return "Cartão / crédito";
  return "Conta financeira";
}

function statusLabel(status: BankConnection["status"]) {
  if (status === "active") return "Conectada";
  if (status === "pending") return "Atualizando";
  if (status === "revoked") return "Revogada";
  return "Atenção";
}

async function functionErrorMessage(error: unknown, fallback: string) {
  const candidate = error as { message?: string; context?: Response } | null;
  let message = candidate?.message || fallback;

  if (candidate?.context) {
    try {
      const body = await candidate.context.clone().json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the original error.
    }
  }

  return message;
}

async function ensurePluggyScript() {
  if (window.PluggyConnect) return;

  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-valora-pluggy="true"]',
  );

  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (window.PluggyConnect) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("SCRIPT_LOAD_FAILED")), {
        once: true,
      });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js";
    script.async = true;
    script.dataset.valoraPluggy = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("SCRIPT_LOAD_FAILED"));
    document.head.appendChild(script);
  });

  if (!window.PluggyConnect) {
    throw new Error("SCRIPT_LOAD_FAILED");
  }
}

export function BankConnectionsPage() {
  const { activeCompany, activeRole } = useCompany();
  const canManage = activeRole === "owner" || activeRole === "admin";

  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState("");
  const [linkingId, setLinkingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    const companyId = activeCompany.id;

    const [
      configResult,
      connectionsResult,
      accountsResult,
      transactionResult,
      localAccountsResult,
      syncRunsResult,
    ] = await Promise.all([
      supabase.functions.invoke("open-finance", {
        body: { action: "config", companyId },
      }),
      supabase
        .from("bank_connections")
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("bank_connection_accounts")
        .select("*")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("bank_connection_transactions")
        .select("id, external_account_id, movement_type, status, amount, description, transaction_date")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .limit(5000),
      supabase
        .from("financial_accounts")
        .select("id, name, active")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("bank_sync_runs")
        .select("*")
        .eq("company_id", companyId)
        .order("started_at", { ascending: false })
        .limit(50),
    ]);

    if (configResult.error) {
      setConfig(null);
    } else {
      setConfig(configResult.data as ProviderConfig);
    }

    const schemaError =
      connectionsResult.error ||
      accountsResult.error ||
      transactionResult.error ||
      syncRunsResult.error;

    if (schemaError) {
      const message = schemaError.message.toLowerCase();
      if (
        message.includes("bank_connections") ||
        message.includes("bank_connection_accounts") ||
        message.includes("bank_connection_transactions")
      ) {
        setError(
          "A estrutura de conexões bancárias ainda não está disponível no Supabase.",
        );
      } else {
        setError("Não foi possível carregar as conexões bancárias.");
      }
    }

    setConnections((connectionsResult.data ?? []) as BankConnection[]);
    setExternalAccounts((accountsResult.data ?? []) as ExternalAccount[]);
    setTransactions((transactionResult.data ?? []) as BankTransaction[]);
    setLocalAccounts((localAccountsResult.data ?? []) as LocalAccount[]);
    setSyncRuns((syncRunsResult.data ?? []) as SyncRun[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [activeCompany?.id]);

  const transactionCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const transaction of transactions) {
      result.set(
        transaction.external_account_id,
        (result.get(transaction.external_account_id) ?? 0) + 1,
      );
    }
    return result;
  }, [transactions]);

  const latestTransactions = useMemo(() => {
    const result = new Map<string, BankTransaction>();
    for (const transaction of transactions) {
      if (!result.has(transaction.external_account_id)) {
        result.set(transaction.external_account_id, transaction);
      }
    }
    return result;
  }, [transactions]);

  const latestRunByConnection = useMemo(() => {
    const result = new Map<string, SyncRun>();
    for (const run of syncRuns) {
      if (!result.has(run.connection_id)) {
        result.set(run.connection_id, run);
      }
    }
    return result;
  }, [syncRuns]);

  const stats = useMemo(
    () => ({
      connections: connections.length,
      accounts: externalAccounts.length,
      linked: externalAccounts.filter((item) => item.local_account_id).length,
      transactions: transactions.length,
    }),
    [connections, externalAccounts, transactions],
  );

  async function invokeOpenFinance(body: Record<string, unknown>) {
    if (!supabase || !activeCompany) throw new Error("Valora não está conectado.");

    const { data, error: invokeError } = await supabase.functions.invoke(
      "open-finance",
      {
        body: {
          ...body,
          companyId: activeCompany.id,
        },
      },
    );

    if (invokeError) {
      throw new Error(
        await functionErrorMessage(
          invokeError,
          "Não foi possível concluir a operação bancária.",
        ),
      );
    }

    if (data?.error) throw new Error(String(data.error));
    return data;
  }

  async function registerItem(itemId: string) {
    setConnecting(true);
    setError("");
    setSuccess("");

    try {
      const result = await invokeOpenFinance({
        action: "register-item",
        itemId,
      });

      setSuccess(
        `Banco conectado. ${result?.accounts ?? 0} conta(s) e ${result?.transactions ?? 0} movimentação(ões) sincronizadas.`,
      );
      await loadData();
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : "A conexão foi autorizada, mas não foi possível sincronizar os dados.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function openConnectWidget(itemId?: string) {
    if (!canManage || connecting) return;

    setConnecting(true);
    setError("");
    setSuccess("");

    try {
      if (!config?.configured) {
        throw new Error(
          "A integração está pronta, mas as credenciais do provedor ainda não foram configuradas no Supabase.",
        );
      }

      const token = await invokeOpenFinance({
        action: "connect-token",
        itemId: itemId || undefined,
      });

      await ensurePluggyScript();

      if (!window.PluggyConnect) throw new Error("Não foi possível abrir o conector bancário.");

      const widget = new window.PluggyConnect({
        connectToken: token.accessToken,
        updateItem: itemId || undefined,
        includeSandbox: Boolean(token.includeSandbox),
        forceOauthInBrowser: true,
        theme: "light",
        onSuccess: async ({ item }) => {
          const connectedItemId = item?.id || itemId;
          if (!connectedItemId) {
            setConnecting(false);
            setError("A instituição confirmou o acesso, mas não retornou a identificação da conexão.");
            return;
          }

          await registerItem(connectedItemId);
        },
        onError: ({ message }) => {
          setConnecting(false);
          setError(message || "A conexão bancária não foi concluída.");
        },
        onClose: () => {
          setConnecting(false);
        },
      });

      widget.init();
    } catch (connectError) {
      setConnecting(false);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Não foi possível iniciar a conexão bancária.",
      );
    }
  }

  async function syncConnection(connection: BankConnection) {
    if (!canManage || syncingId) return;

    setSyncingId(connection.id);
    setError("");
    setSuccess("");

    try {
      const result = await invokeOpenFinance({
        action: "sync",
        connectionId: connection.id,
      });

      setSuccess(
        `${connection.institution_name} sincronizado: ${result?.accounts ?? 0} conta(s) e ${result?.transactions ?? 0} movimentação(ões) atualizadas.`,
      );
      await loadData();
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Não foi possível sincronizar a instituição.",
      );
    } finally {
      setSyncingId("");
    }
  }

  async function linkLocalAccount(
    externalAccount: ExternalAccount,
    localAccountId: string,
  ) {
    if (!supabase || !activeCompany || !canManage || linkingId) return;

    setLinkingId(externalAccount.id);
    setError("");
    setSuccess("");

    const { error: updateError } = await supabase
      .from("bank_connection_accounts")
      .update({
        local_account_id: localAccountId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", externalAccount.id)
      .eq("company_id", activeCompany.id);

    if (updateError) {
      setError("Não foi possível vincular esta conta bancária ao Valora.");
      setLinkingId("");
      return;
    }

    setExternalAccounts((current) =>
      current.map((item) =>
        item.id === externalAccount.id
          ? { ...item, local_account_id: localAccountId || null }
          : item,
      ),
    );
    setSuccess(
      localAccountId
        ? "Conta vinculada. Ela já está pronta para a próxima etapa de conciliação automática."
        : "Vínculo removido.",
    );
    setLinkingId("");
  }

  if (loading) {
    return (
      <>
        <header className="page-header">
          <p className="eyebrow">OPEN FINANCE</p>
          <h1>Conexões bancárias</h1>
          <p>Carregando integrações financeiras...</p>
        </header>
        <section className="panel empty-state">Carregando conexões...</section>
      </>
    );
  }

  return (
    <>
      <header className="page-header split bank-connections-page-header">
        <div>
          <p className="eyebrow">OPEN FINANCE</p>
          <h1>Conexões bancárias</h1>
          <p>
            Conecte instituições financeiras, sincronize saldos e mantenha as movimentações bancárias prontas para conciliação.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            className="primary bank-connect-button"
            onClick={() => void openConnectWidget()}
            disabled={connecting || !config?.configured}
          >
            <span aria-hidden="true">+</span>
            {connecting ? "Abrindo conexão..." : "Conectar banco"}
          </button>
        )}
      </header>

      {error && <div className="form-alert error page-alert">{error}</div>}
      {success && <div className="form-alert success page-alert">{success}</div>}

      {!canManage && (
        <div className="bank-readonly-note">
          Seu perfil está em modo somente leitura. Você pode consultar as conexões, mas não criar, sincronizar ou alterar vínculos.
        </div>
      )}

      {!config?.configured && (
        <section className="bank-provider-setup">
          <div className="bank-provider-setup-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 10h16" />
              <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
              <path d="M3 20h18M12 3 3 8h18L12 3Z" />
            </svg>
          </div>
          <div>
            <span>INTEGRAÇÃO PREPARADA</span>
            <h2>Falta somente habilitar o provedor bancário</h2>
            <p>
              A estrutura do Valora já está ativa. Para abrir o fluxo real de autorização, configure <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> nos secrets das Edge Functions do Supabase.
            </p>
          </div>
          <span className="bank-provider-badge">Pluggy</span>
        </section>
      )}

      <section className="bank-connection-stats">
        <article>
          <span>Instituições</span>
          <strong>{stats.connections}</strong>
          <small>conexões cadastradas</small>
        </article>
        <article>
          <span>Contas encontradas</span>
          <strong>{stats.accounts}</strong>
          <small>contas e cartões externos</small>
        </article>
        <article>
          <span>Vinculadas ao Valora</span>
          <strong>{stats.linked}</strong>
          <small>prontas para conciliação</small>
        </article>
        <article>
          <span>Movimentações</span>
          <strong>{stats.transactions}</strong>
          <small>sincronizadas no feed bancário</small>
        </article>
      </section>

      {connections.length === 0 ? (
        <section className="panel bank-empty-state">
          <div className="bank-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 10h16" />
              <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
              <path d="M3 20h18M12 3 3 8h18L12 3Z" />
            </svg>
          </div>
          <div>
            <h2>Nenhum banco conectado</h2>
            <p>
              Quando o provedor estiver configurado, use “Conectar banco” para autorizar uma instituição. As credenciais bancárias não são armazenadas pelo Valora.
            </p>
          </div>
        </section>
      ) : (
        <div className="bank-connections-list">
          {connections.map((connection) => {
            const accounts = externalAccounts.filter(
              (item) => item.connection_id === connection.id,
            );
            const run = latestRunByConnection.get(connection.id);

            return (
              <section className="panel bank-connection-card" key={connection.id}>
                <div className="bank-connection-card-header">
                  <div className="bank-institution">
                    <div
                      className="bank-institution-logo"
                      style={
                        connection.institution_primary_color
                          ? { background: connection.institution_primary_color }
                          : undefined
                      }
                    >
                      {connection.institution_logo_url ? (
                        <img
                          src={connection.institution_logo_url}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <span>{connection.institution_name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <div className="bank-institution-title">
                        <h2>{connection.institution_name}</h2>
                        <span className={"bank-status " + connection.status}>
                          {statusLabel(connection.status)}
                        </span>
                      </div>
                      <p>
                        {connection.connection_type === "open_finance"
                          ? "Open Finance regulado"
                          : "Conector financeiro"}{" "}
                        · Última sincronização: {formatDateTime(connection.last_successful_sync_at)}
                      </p>
                    </div>
                  </div>

                  {canManage && (
                    <div className="bank-connection-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void openConnectWidget(connection.provider_item_id)}
                        disabled={connecting || Boolean(syncingId) || !config?.configured}
                      >
                        Atualizar acesso
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void syncConnection(connection)}
                        disabled={Boolean(syncingId) || connecting || !config?.configured}
                      >
                        {syncingId === connection.id ? "Sincronizando..." : "Sincronizar"}
                      </button>
                    </div>
                  )}
                </div>

                {connection.last_error && (
                  <div className="bank-connection-error">
                    <strong>A conexão precisa de atenção</strong>
                    <span>{connection.last_error}</span>
                  </div>
                )}

                {run?.status === "success" && (
                  <div className="bank-sync-summary">
                    Última leitura: {run.accounts_synced} conta(s), {run.transactions_upserted} movimentação(ões) processadas.
                  </div>
                )}

                <div className="bank-external-accounts">
                  {accounts.length === 0 ? (
                    <div className="bank-account-empty">
                      Nenhuma conta foi retornada por esta instituição.
                    </div>
                  ) : (
                    accounts.map((account) => {
                      const latest = latestTransactions.get(account.id);
                      const count = transactionCounts.get(account.id) ?? 0;

                      return (
                        <article className="bank-external-account" key={account.id}>
                          <div className="bank-account-main">
                            <div className="bank-account-copy">
                              <span>{accountTypeLabel(account.account_type)}</span>
                              <strong>{account.name}</strong>
                              <small>
                                {account.number_masked || "Número não informado"} · {account.currency_code}
                              </small>
                            </div>
                            <div className="bank-account-balance">
                              <span>Saldo informado</span>
                              <strong>
                                {account.balance === null
                                  ? "Indisponível"
                                  : money.format(Number(account.balance))}
                              </strong>
                              <small>{count} movimentação(ões) no feed</small>
                            </div>
                          </div>

                          <div className="bank-account-footer">
                            <label>
                              Vincular à conta do Valora
                              <select
                                value={account.local_account_id ?? ""}
                                onChange={(event) =>
                                  void linkLocalAccount(account, event.target.value)
                                }
                                disabled={!canManage || linkingId === account.id}
                              >
                                <option value="">Não vinculada</option>
                                {localAccounts.map((local) => (
                                  <option key={local.id} value={local.id}>
                                    {local.name}{local.active ? "" : " · inativa"}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <div className="bank-account-latest">
                              <span>Movimentação mais recente</span>
                              {latest ? (
                                <>
                                  <strong>{latest.description}</strong>
                                  <small>
                                    {new Intl.DateTimeFormat("pt-BR").format(
                                      new Date(latest.transaction_date + "T12:00:00"),
                                    )}{" "}
                                    · {latest.movement_type === "income" ? "+" : "−"}{" "}
                                    {money.format(Number(latest.amount))}
                                  </small>
                                </>
                              ) : (
                                <small>Nenhuma movimentação sincronizada.</small>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="bank-privacy-note">
        <strong>Privacidade por desenho</strong>
        <span>
          O Valora guarda somente identificadores da conexão, contas mascaradas, saldos e movimentações necessárias para gestão financeira. Senhas bancárias, tokens de MFA e documentos do titular não são persistidos no banco do Valora.
        </span>
      </section>
    </>
  );
}
