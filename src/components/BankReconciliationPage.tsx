import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import {
  parseStatementFile,
  type StatementImportRow,
  type StatementParseResult,
} from "../lib/statementImport";

type Account = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
};

type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  type: "income" | "expense";
  status: "pending" | "paid" | "cancelled";
  due_date: string;
  paid_at: string | null;
  account_id: string | null;
};

type Reconciliation = {
  transaction_id: string;
  statement_reference: string | null;
  statement_date: string;
};

type Candidate = {
  transaction: Transaction;
  score: number;
};

type Recommendation = {
  row: StatementImportRow;
  reference: string;
  alreadyReconciled: boolean;
  candidates: Candidate[];
  defaultChoice: string;
  confidence: "strong" | "possible" | "none";
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function normalizedWords(value: string) {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  );
}

function descriptionSimilarity(a: string, b: string) {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union ? overlap / union : 0;
}

function daysApart(a: string, b: string) {
  const first = new Date(a + "T12:00:00").getTime();
  const second = new Date(b + "T12:00:00").getTime();
  return Math.round(Math.abs(first - second) / 86400000);
}

function transactionDate(transaction: Transaction) {
  return transaction.paid_at?.slice(0, 10) || transaction.due_date;
}

function statementReference(row: StatementImportRow) {
  return row.sourceId?.trim() || row.id;
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

export function BankReconciliationPage() {
  const { activeCompany, activeRole } = useCompany();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = activeRole !== "viewer";

  useEffect(() => {
    if (!supabase || !activeCompany) return;

    const client = supabase;
    const companyId = activeCompany.id;
    let cancelled = false;

    async function loadAccounts() {
      setLoading(true);
      setError("");

      const { data, error: accountError } = await client
        .from("financial_accounts")
        .select("id, name, kind, active")
        .eq("company_id", companyId)
        .order("active", { ascending: false })
        .order("name");

      if (cancelled) return;

      if (accountError) {
        setError("Não foi possível carregar as contas e caixas.");
        setLoading(false);
        return;
      }

      const loaded = (data ?? []) as Account[];
      setAccounts(loaded);
      setAccountId((current) =>
        loaded.some((account) => account.id === current)
          ? current
          : loaded.find((account) => account.active)?.id ?? loaded[0]?.id ?? "",
      );
      setLoading(false);
    }

    void loadAccounts();

    return () => {
      cancelled = true;
    };
  }, [activeCompany?.id]);

  useEffect(() => {
    if (!supabase || !activeCompany || !accountId) {
      setTransactions([]);
      setReconciliations([]);
      return;
    }

    const client = supabase;
    const companyId = activeCompany.id;
    let cancelled = false;

    async function loadAccountData() {
      setLoadingAccount(true);
      setError("");

      const [transactionResult, reconciliationResult] = await Promise.all([
        client
          .from("transactions")
          .select("id, description, amount, type, status, due_date, paid_at, account_id")
          .eq("company_id", companyId)
          .eq("account_id", accountId)
          .eq("status", "paid")
          .order("due_date", { ascending: false })
          .limit(2500),
        client
          .from("bank_reconciliations")
          .select("transaction_id, statement_reference, statement_date")
          .eq("company_id", companyId)
          .eq("account_id", accountId)
          .order("statement_date", { ascending: false })
          .limit(2500),
      ]);

      if (cancelled) return;

      if (transactionResult.error) {
        setError("Não foi possível carregar as movimentações desta conta.");
        setLoadingAccount(false);
        return;
      }

      setTransactions((transactionResult.data ?? []) as Transaction[]);

      if (reconciliationResult.error) {
        const missingTable =
          reconciliationResult.error.code === "42P01" ||
          reconciliationResult.error.message.toLowerCase().includes("bank_reconciliations");

        if (missingTable) {
          setSchemaReady(false);
          setReconciliations([]);
        } else {
          setError("Não foi possível carregar o histórico de conciliações.");
        }
      } else {
        setSchemaReady(true);
        setReconciliations((reconciliationResult.data ?? []) as Reconciliation[]);
      }

      setLoadingAccount(false);
    }

    void loadAccountData();

    return () => {
      cancelled = true;
    };
  }, [activeCompany?.id, accountId]);

  useEffect(() => {
    setParsed(null);
    setFileName("");
    setChoices({});
    setSuccess("");
  }, [accountId]);

  const reconciledTransactionIds = useMemo(
    () => new Set(reconciliations.map((item) => item.transaction_id)),
    [reconciliations],
  );

  const reconciledReferences = useMemo(
    () =>
      new Set(
        reconciliations
          .map((item) => item.statement_reference)
          .filter((value): value is string => Boolean(value)),
      ),
    [reconciliations],
  );

  const recommendations = useMemo<Recommendation[]>(() => {
    if (!parsed) return [];

    const usedByAutoMatch = new Set<string>();

    return parsed.rows.map((row) => {
      const reference = statementReference(row);
      const alreadyReconciled = reconciledReferences.has(reference);

      if (alreadyReconciled) {
        return {
          row,
          reference,
          alreadyReconciled: true,
          candidates: [],
          defaultChoice: "__done__",
          confidence: "none",
        };
      }

      const candidates = transactions
        .filter((transaction) => {
          if (reconciledTransactionIds.has(transaction.id)) return false;
          if (transaction.type !== row.type) return false;
          if (Math.abs(Number(transaction.amount) - row.amount) > 0.009) return false;
          return daysApart(transactionDate(transaction), row.date) <= 7;
        })
        .map((transaction) => {
          const distance = daysApart(transactionDate(transaction), row.date);
          const dateScore =
            distance === 0 ? 70 : distance === 1 ? 58 : distance === 2 ? 46 : distance <= 4 ? 32 : 20;
          const descriptionScore =
            Math.round(descriptionSimilarity(row.description, transaction.description) * 30);

          return {
            transaction,
            score: dateScore + descriptionScore,
          };
        })
        .sort((a, b) => b.score - a.score);

      const best = candidates.find((candidate) => !usedByAutoMatch.has(candidate.transaction.id));
      let defaultChoice = "__new__";
      let confidence: Recommendation["confidence"] = "none";

      if (best && best.score >= 55) {
        defaultChoice = best.transaction.id;
        usedByAutoMatch.add(best.transaction.id);
        confidence = best.score >= 80 ? "strong" : "possible";
      }

      return {
        row,
        reference,
        alreadyReconciled: false,
        candidates,
        defaultChoice,
        confidence,
      };
    });
  }, [parsed, reconciledReferences, reconciledTransactionIds, transactions]);

  const effectiveChoices = useMemo(() => {
    const result: Record<string, string> = {};
    for (const recommendation of recommendations) {
      result[recommendation.row.id] =
        choices[recommendation.row.id] ?? recommendation.defaultChoice;
    }
    return result;
  }, [choices, recommendations]);

  const summary = useMemo(() => {
    const result = {
      total: recommendations.length,
      already: 0,
      match: 0,
      create: 0,
      skip: 0,
    };

    for (const recommendation of recommendations) {
      const choice = effectiveChoices[recommendation.row.id];
      if (recommendation.alreadyReconciled || choice === "__done__") result.already += 1;
      else if (choice === "__skip__") result.skip += 1;
      else if (choice === "__new__") result.create += 1;
      else if (choice) result.match += 1;
    }

    return result;
  }, [effectiveChoices, recommendations]);

  const selectedTransactionIds = useMemo(() => {
    const ids = new Map<string, number>();

    for (const recommendation of recommendations) {
      const choice = effectiveChoices[recommendation.row.id];
      if (!choice || choice.startsWith("__")) continue;
      ids.set(choice, (ids.get(choice) ?? 0) + 1);
    }

    return ids;
  }, [effectiveChoices, recommendations]);

  const hasTransactionConflict = Array.from(selectedTransactionIds.values()).some(
    (count) => count > 1,
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParsing(true);
    setError("");
    setSuccess("");

    try {
      const result = await parseStatementFile(file);
      setParsed(result);
      setFileName(file.name);
      setChoices({});
    } catch (parseError) {
      setParsed(null);
      setFileName("");
      setChoices({});
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Não foi possível ler este extrato.",
      );
    } finally {
      setParsing(false);
    }
  }

  async function reloadReconciliations() {
    if (!supabase || !activeCompany || !accountId) return;

    const client = supabase;
    const companyId = activeCompany.id;

    const [transactionResult, reconciliationResult] = await Promise.all([
      client
        .from("transactions")
        .select("id, description, amount, type, status, due_date, paid_at, account_id")
        .eq("company_id", companyId)
        .eq("account_id", accountId)
        .eq("status", "paid")
        .order("due_date", { ascending: false })
        .limit(2500),
      client
        .from("bank_reconciliations")
        .select("transaction_id, statement_reference, statement_date")
        .eq("company_id", companyId)
        .eq("account_id", accountId)
        .order("statement_date", { ascending: false })
        .limit(2500),
    ]);

    if (!transactionResult.error) {
      setTransactions((transactionResult.data ?? []) as Transaction[]);
    }

    if (!reconciliationResult.error) {
      setSchemaReady(true);
      setReconciliations((reconciliationResult.data ?? []) as Reconciliation[]);
    }
  }

  async function confirmReconciliation() {
    if (!supabase || !activeCompany || !accountId || !parsed) return;

    const client = supabase;
    const companyId = activeCompany.id;

    if (!canManage) {
      setError("Seu perfil possui acesso somente para leitura.");
      return;
    }

    if (schemaReady !== true) {
      setError(
        "A estrutura de conciliação ainda não foi aplicada no Supabase.",
      );
      return;
    }

    if (hasTransactionConflict) {
      setError(
        "Um mesmo lançamento foi selecionado para mais de uma linha do extrato. Revise as correspondências.",
      );
      return;
    }

    const pending = recommendations.filter((recommendation) => {
      const choice = effectiveChoices[recommendation.row.id];
      return !recommendation.alreadyReconciled && choice !== "__skip__" && choice !== "__done__";
    });

    if (!pending.length) {
      setError("Não há itens novos para conciliar.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    let completed = 0;

    for (const recommendation of pending) {
      const choice = effectiveChoices[recommendation.row.id];
      const transactionId = choice === "__new__" ? null : choice;

      const { error: reconcileError } = await client.rpc(
        "reconcile_bank_statement_entry",
        {
          p_company_id: companyId,
          p_account_id: accountId,
          p_transaction_id: transactionId,
          p_source_format: parsed.format,
          p_statement_reference: recommendation.reference,
          p_statement_date: recommendation.row.date,
          p_statement_description: recommendation.row.description,
          p_statement_amount: recommendation.row.amount,
          p_statement_type: recommendation.row.type,
        },
      );

      if (reconcileError) {
        setError(
          `A conciliação foi interrompida após ${completed} item${completed === 1 ? "" : "s"}. ${reconcileError.message}`,
        );
        setSaving(false);
        await reloadReconciliations();
        return;
      }

      completed += 1;
    }

    await reloadReconciliations();
    setChoices({});
    setSuccess(
      `${completed} movimentação${completed === 1 ? "" : "ões"} conciliada${completed === 1 ? "" : "s"} com sucesso.`,
    );
    setSaving(false);
  }

  if (loading) {
    return (
      <>
        <header className="page-header">
          <p className="eyebrow">FINANCEIRO</p>
          <h1>Conciliação bancária</h1>
          <p>Compare o extrato do banco com os lançamentos do Valora.</p>
        </header>
        <section className="panel empty-state">Carregando contas...</section>
      </>
    );
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">FINANCEIRO</p>
          <h1>Conciliação bancária</h1>
          <p>
            Compare um extrato CSV, Excel ou OFX com as movimentações já registradas no Valora.
          </p>
        </div>
      </header>

      {schemaReady === false && (
        <div className="reconciliation-schema-warning">
          <strong>Ativação necessária no banco de dados</strong>
          <span>
            Aplique a migration <code>20261028_012_bank_reconciliation.sql</code> no Supabase antes de confirmar conciliações.
          </span>
        </div>
      )}

      {!canManage && (
        <div className="reconciliation-readonly-note">
          Seu perfil está em modo somente leitura. Você pode revisar a conciliação, mas não confirmá-la.
        </div>
      )}

      <section className="panel reconciliation-setup">
        <div className="reconciliation-setup-grid">
          <label>
            Conta ou caixa
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={saving}
            >
              <option value="">Selecione</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.active ? "" : " • inativa"}
                </option>
              ))}
            </select>
          </label>

          <div className="reconciliation-file">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.xlsb,.ods,.ofx,.qfx"
              onChange={handleFile}
              disabled={!accountId || parsing || saving}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={!accountId || parsing || saving}
            >
              {parsing ? "Lendo extrato..." : fileName ? "Trocar extrato" : "Selecionar extrato"}
            </button>
            <div>
              <strong>{fileName || "Nenhum extrato selecionado"}</strong>
              <small>
                {parsed
                  ? `${parsed.format} • ${parsed.rows.length} movimentação${parsed.rows.length === 1 ? "" : "ões"}`
                  : "CSV, Excel, ODS, OFX ou QFX"}
              </small>
            </div>
          </div>
        </div>
      </section>

      {loadingAccount && (
        <div className="reconciliation-loading">Analisando movimentações da conta...</div>
      )}

      {error && <div className="form-alert error page-alert">{error}</div>}
      {success && <div className="form-alert success page-alert">{success}</div>}

      {parsed && recommendations.length > 0 && (
        <>
          <section className="reconciliation-summary">
            <article>
              <span>No extrato</span>
              <strong>{summary.total}</strong>
              <small>movimentações lidas</small>
            </article>
            <article>
              <span>Já conciliadas</span>
              <strong>{summary.already}</strong>
              <small>nenhuma ação necessária</small>
            </article>
            <article>
              <span>Vincular existentes</span>
              <strong>{summary.match}</strong>
              <small>sugestões ou escolhas manuais</small>
            </article>
            <article>
              <span>Criar no Valora</span>
              <strong>{summary.create}</strong>
              <small>movimentações ainda não registradas</small>
            </article>
          </section>

          {hasTransactionConflict && (
            <div className="reconciliation-conflict">
              O mesmo lançamento foi associado a mais de uma linha. Escolha lançamentos diferentes antes de confirmar.
            </div>
          )}

          <section className="panel table-panel reconciliation-table-panel">
            <div className="table-scroll">
              <table className="reconciliation-table">
                <thead>
                  <tr>
                    <th>Extrato bancário</th>
                    <th>Tipo</th>
                    <th className="right">Valor</th>
                    <th>Conciliação</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((recommendation) => {
                    const row = recommendation.row;
                    const choice = effectiveChoices[row.id];
                    const selectedCandidate = recommendation.candidates.find(
                      (candidate) => candidate.transaction.id === choice,
                    );

                    return (
                      <tr
                        key={row.id}
                        className={recommendation.alreadyReconciled ? "reconciled" : ""}
                      >
                        <td>
                          <div className="reconciliation-bank-entry">
                            <strong>{row.description}</strong>
                            <span>
                              {formatDate(row.date)}
                              {row.sourceId ? ` • ref. ${row.sourceId}` : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`pill ${row.type}`}>
                            {row.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className={`right amount ${row.type}`}>
                          {row.type === "income" ? "+" : "−"} {money.format(row.amount)}
                        </td>
                        <td>
                          {recommendation.alreadyReconciled ? (
                            <span className="reconciliation-status done">Conciliado</span>
                          ) : (
                            <div className="reconciliation-match-cell">
                              <select
                                value={choice}
                                onChange={(event) =>
                                  setChoices((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                                disabled={saving || !canManage}
                              >
                                <option value="__new__">Importar como novo lançamento</option>
                                {recommendation.candidates.map((candidate) => (
                                  <option
                                    key={candidate.transaction.id}
                                    value={candidate.transaction.id}
                                  >
                                    {formatDate(transactionDate(candidate.transaction))} • {candidate.transaction.description} • {money.format(Number(candidate.transaction.amount))}
                                  </option>
                                ))}
                                <option value="__skip__">Ignorar esta movimentação</option>
                              </select>

                              {choice === "__new__" && (
                                <small>Nenhum lançamento existente será alterado.</small>
                              )}
                              {choice === "__skip__" && (
                                <small>Esta linha não será conciliada nem importada.</small>
                              )}
                              {selectedCandidate && (
                                <small>
                                  {recommendation.confidence === "strong"
                                    ? "Sugestão forte por valor, data e descrição."
                                    : recommendation.confidence === "possible"
                                      ? "Sugestão automática. Revise antes de confirmar."
                                      : "Correspondência escolhida manualmente."}
                                </small>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="reconciliation-actions">
              <span>
                {summary.skip > 0
                  ? `${summary.skip} item${summary.skip === 1 ? "" : "s"} será${summary.skip === 1 ? "" : "ão"} ignorado${summary.skip === 1 ? "" : "s"}.`
                  : "Revise as sugestões antes de confirmar."}
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => void confirmReconciliation()}
                disabled={
                  saving ||
                  !canManage ||
                  schemaReady !== true ||
                  hasTransactionConflict ||
                  summary.match + summary.create === 0
                }
              >
                {saving
                  ? "Conciliando..."
                  : `Confirmar ${summary.match + summary.create} item${summary.match + summary.create === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>

          {parsed.skipped > 0 && (
            <p className="reconciliation-footnote">
              {parsed.skipped} linha{parsed.skipped === 1 ? "" : "s"} do arquivo foi{parsed.skipped === 1 ? "" : "ram"} ignorada{parsed.skipped === 1 ? "" : "s"} por dados inválidos ou incompletos.
            </p>
          )}
        </>
      )}

      {!parsed && (
        <section className="panel reconciliation-empty">
          <strong>Comece escolhendo uma conta e um extrato.</strong>
          <span>
            O Valora compara valores, datas e descrições para sugerir quais lançamentos correspondem às movimentações do banco.
          </span>
        </section>
      )}
    </>
  );
}
