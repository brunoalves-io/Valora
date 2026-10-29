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

type LinkedBankAccount = {
  id: string;
  name: string;
  provider_account_id: string;
};

type OpenFinanceTransaction = {
  id: string;
  external_account_id: string;
  provider_transaction_id: string;
  description: string;
  movement_type: "income" | "expense";
  status: "POSTED" | "PENDING" | "UNKNOWN";
  amount: number | string;
  transaction_date: string;
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

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function BankSourceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 9.25h17" />
      <path d="M5.5 9.25v8.5M9.75 9.25v8.5M14.25 9.25v8.5M18.5 9.25v8.5" />
      <path d="M3.5 19.5h17" />
      <path d="M12 3.5 3.75 7.5h16.5L12 3.5Z" />
    </svg>
  );
}

function UploadSourceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.75h7.25l3.75 3.75v12.75H6.5Z" />
      <path d="M13.75 3.75V7.5h3.75" />
      <path d="M12 16.5V10.5" />
      <path d="m9.75 12.75 2.25-2.25 2.25 2.25" />
    </svg>
  );
}

function SyncSourceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.25 8.25A7.5 7.5 0 0 0 6.1 6.1L4.5 7.75" />
      <path d="M4.5 4.75v3h3" />
      <path d="M4.75 15.75A7.5 7.5 0 0 0 17.9 17.9l1.6-1.65" />
      <path d="M19.5 19.25v-3h-3" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3.75" width="14" height="16.5" rx="2" />
      <path d="M8.5 8h7M8.5 11.75h7M8.5 15.5h5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path d="m8.5 12.2 2.25 2.25 4.75-5" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 17 16.5 5.5" />
      <path d="M10.75 5.5h5.75v5.75" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MovementIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 8h6M9 11.75h6M9 15.5h4" />
    </svg>
  );
}

export function BankReconciliationPage() {
  const { activeCompany, activeRole } = useCompany();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [linkedBankAccounts, setLinkedBankAccounts] = useState<LinkedBankAccount[]>([]);
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [loadingOpenFinance, setLoadingOpenFinance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "30" | "60" | "90">("all");
  const [situationFilter, setSituationFilter] = useState<
    "all" | "done" | "match" | "new" | "skip"
  >("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
      setLinkedBankAccounts([]);
      return;
    }

    const client = supabase;
    const companyId = activeCompany.id;
    let cancelled = false;

    async function loadAccountData() {
      setLoadingAccount(true);
      setError("");

      const [transactionResult, reconciliationResult, linkedAccountResult] = await Promise.all([
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
        client
          .from("bank_connection_accounts")
          .select("id, name, provider_account_id")
          .eq("company_id", companyId)
          .eq("local_account_id", accountId)
          .order("name"),
      ]);

      if (cancelled) return;

      if (transactionResult.error) {
        setError("Não foi possível carregar as movimentações desta conta.");
        setLoadingAccount(false);
        return;
      }

      setTransactions((transactionResult.data ?? []) as Transaction[]);

      if (linkedAccountResult.error) {
        setLinkedBankAccounts([]);
      } else {
        setLinkedBankAccounts((linkedAccountResult.data ?? []) as LinkedBankAccount[]);
      }

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
    setSearch("");
    setTypeFilter("all");
    setPeriodFilter("all");
    setSituationFilter("all");
    setShowMoreFilters(false);
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

      const availableCandidates = candidates.filter(
        (candidate) => !usedByAutoMatch.has(candidate.transaction.id),
      );
      const best = availableCandidates[0];
      const second = availableCandidates[1];
      const isUniqueCandidate = availableCandidates.length === 1;
      const leadOverSecond = best && second ? best.score - second.score : Number.POSITIVE_INFINITY;
      const shouldAutoMatch = Boolean(
        best &&
          (
            (best.score >= 80 && leadOverSecond >= 12) ||
            (isUniqueCandidate && best.score >= 60)
          ),
      );

      let defaultChoice = "__new__";
      let confidence: Recommendation["confidence"] = "none";

      if (best && shouldAutoMatch) {
        defaultChoice = best.transaction.id;
        usedByAutoMatch.add(best.transaction.id);
        confidence =
          best.score >= 85 || (isUniqueCandidate && best.score >= 70)
            ? "strong"
            : "possible";
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

  const activeSource = useMemo<"open-finance" | "file" | "none">(() => {
    if (parsed?.format === "Open Finance") return "open-finance";
    if (parsed) return "file";
    if (linkedBankAccounts.length) return "open-finance";
    return "none";
  }, [parsed, linkedBankAccounts.length]);

  const filteredRecommendations = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);
    const now = Date.now();

    return recommendations.filter((recommendation) => {
      const row = recommendation.row;
      const choice = effectiveChoices[row.id];

      if (typeFilter !== "all" && row.type !== typeFilter) return false;

      if (periodFilter !== "all") {
        const rowDate = new Date(row.date + "T12:00:00").getTime();
        const days = Number(periodFilter);
        if (!Number.isFinite(rowDate) || now - rowDate > days * 86400000) return false;
      }

      if (situationFilter !== "all") {
        const situation =
          recommendation.alreadyReconciled || choice === "__done__"
            ? "done"
            : choice === "__skip__"
              ? "skip"
              : choice === "__new__"
                ? "new"
                : "match";

        if (situation !== situationFilter) return false;
      }

      if (normalizedQuery) {
        const searchable = normalizeSearch(
          [
            row.description,
            row.sourceId ?? "",
            row.date,
            money.format(row.amount),
            row.type === "income" ? "receita" : "despesa",
          ].join(" "),
        );

        if (!searchable.includes(normalizedQuery)) return false;
      }

      return true;
    });
  }, [
    recommendations,
    effectiveChoices,
    search,
    typeFilter,
    periodFilter,
    situationFilter,
  ]);

  const reconciledPercent = summary.total
    ? Math.round((summary.already / summary.total) * 1000) / 10
    : 0;
  const matchPercent = summary.total
    ? Math.round((summary.match / summary.total) * 1000) / 10
    : 0;
  const createPercent = summary.total
    ? Math.round((summary.create / summary.total) * 1000) / 10
    : 0;

  async function loadOpenFinanceFeed() {
    if (!supabase || !activeCompany || !accountId || loadingOpenFinance) return;

    if (!linkedBankAccounts.length) {
      setError(
        "Esta conta ainda não está vinculada a uma conta bancária em Conexões bancárias.",
      );
      return;
    }

    setLoadingOpenFinance(true);
    setError("");
    setSuccess("");

    const externalAccountIds = linkedBankAccounts.map((item) => item.id);
    const { data, error: feedError } = await supabase
      .from("bank_connection_transactions")
      .select(
        "id, external_account_id, provider_transaction_id, description, movement_type, status, amount, transaction_date",
      )
      .eq("company_id", activeCompany.id)
      .in("external_account_id", externalAccountIds)
      .eq("status", "POSTED")
      .order("transaction_date", { ascending: false })
      .limit(5000);

    if (feedError) {
      setError("Não foi possível carregar as movimentações do Open Finance.");
      setLoadingOpenFinance(false);
      return;
    }

    const feed = (data ?? []) as OpenFinanceTransaction[];
    const rows: StatementImportRow[] = feed
      .filter(
        (item) =>
          item.provider_transaction_id &&
          item.description &&
          Number(item.amount) > 0 &&
          (item.movement_type === "income" || item.movement_type === "expense"),
      )
      .map((item) => ({
        id: `open-finance-${item.id}`,
        sourceId: `pluggy:${item.external_account_id}:${item.provider_transaction_id}`,
        date: item.transaction_date,
        description: item.description,
        amount: Number(item.amount),
        type: item.movement_type,
      }));

    if (!rows.length) {
      setParsed(null);
      setFileName("");
      setChoices({});
      setError(
        "Nenhuma movimentação confirmada foi encontrada no feed Open Finance desta conta.",
      );
      setLoadingOpenFinance(false);
      return;
    }

    setParsed({
      format: "Open Finance",
      rows,
      skipped: feed.length - rows.length,
    });
    setFileName(
      `Open Finance · ${linkedBankAccounts.length} conta${linkedBankAccounts.length === 1 ? "" : "s"} vinculada${linkedBankAccounts.length === 1 ? "" : "s"}`,
    );
    setChoices({});
    setLoadingOpenFinance(false);
  }

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
      <header className="page-header split reconciliation-premium-header">
        <div>
          <p className="eyebrow">FINANCEIRO</p>
          <h1>Conciliação bancária</h1>
          <p>
            Compare e concilie as movimentações do Open Finance ou importe um extrato
            (CSV, Excel ou OFX) com os lançamentos já registrados no Valora.
          </p>
        </div>
        <button
          type="button"
          className="ghost reconciliation-help-button"
          onClick={() => setShowHelp((current) => !current)}
        >
          <span aria-hidden="true">?</span>
          Como funciona?
        </button>
      </header>

      {showHelp && (
        <section className="reconciliation-help-panel">
          <div>
            <strong>1. Escolha a origem</strong>
            <span>Use o Open Finance ou carregue um extrato bancário.</span>
          </div>
          <div>
            <strong>2. Revise as sugestões</strong>
            <span>O Valora compara valor, data e descrição com seus lançamentos.</span>
          </div>
          <div>
            <strong>3. Confirme</strong>
            <span>Vincule lançamentos existentes, crie novos ou ignore o que não deve entrar.</span>
          </div>
        </section>
      )}

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

      <section className="panel reconciliation-premium-setup">
        <div className="reconciliation-account-column">
          <div className="reconciliation-section-heading">
            <strong>Conta ou caixa</strong>
            <span>Selecione a conta usada nesta conciliação</span>
          </div>

          <label className="reconciliation-account-select">
            <span className="reconciliation-account-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 10h16" />
                <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
                <path d="M3 20h18M12 3 3 8h18L12 3Z" />
              </svg>
            </span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={saving}
            >
              <option value="">Selecione uma conta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.active ? "" : " • inativa"}
                </option>
              ))}
            </select>
          </label>

          <div
            className={
              linkedBankAccounts.length
                ? "reconciliation-link-state connected"
                : "reconciliation-link-state"
            }
          >
            <span aria-hidden="true">
              {linkedBankAccounts.length ? <CheckCircleIcon /> : "!"}
            </span>
            <div>
              <strong>
                {linkedBankAccounts.length
                  ? "Conta vinculada ao Open Finance"
                  : "Conta sem vínculo com Open Finance"}
              </strong>
              <small>
                {linkedBankAccounts.length
                  ? `${linkedBankAccounts.length} conta${linkedBankAccounts.length === 1 ? "" : "s"} bancária${linkedBankAccounts.length === 1 ? "" : "s"} conectada${linkedBankAccounts.length === 1 ? "" : "s"}`
                  : "Vincule uma conta em Conexões bancárias para usar o feed automático."}
              </small>
            </div>
          </div>
        </div>

        <div className="reconciliation-source-column">
          <div className="reconciliation-section-heading">
            <strong>Origem dos dados</strong>
            <span>Escolha como carregar as movimentações</span>
          </div>

          <div className="reconciliation-source-tabs">
            <button
              type="button"
              className={activeSource === "open-finance" ? "active" : ""}
              onClick={() => void loadOpenFinanceFeed()}
              disabled={
                !accountId ||
                !linkedBankAccounts.length ||
                loadingOpenFinance ||
                parsing ||
                saving
              }
            >
              <span className="source-tab-icon" aria-hidden="true">
                <BankSourceIcon />
              </span>
              <span>
                <strong>Open Finance</strong>
                <small>{linkedBankAccounts.length ? "Feed bancário conectado" : "Sem conta vinculada"}</small>
              </span>
              <i aria-hidden="true" />
            </button>

            <span className="reconciliation-source-or">OU</span>

            <button
              type="button"
              className={activeSource === "file" ? "active file" : "file"}
              onClick={() => fileInputRef.current?.click()}
              disabled={!accountId || parsing || saving}
            >
              <span className="source-tab-icon" aria-hidden="true">
                <UploadSourceIcon />
              </span>
              <span>
                <strong>{activeSource === "file" ? "Trocar extrato" : "Importar arquivo"}</strong>
                <small>CSV, Excel, ODS, OFX ou QFX</small>
              </span>
              <i aria-hidden="true" />
            </button>
          </div>

          <input
            ref={fileInputRef}
            className="reconciliation-hidden-file"
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.xlsb,.ods,.ofx,.qfx"
            onChange={handleFile}
            disabled={!accountId || parsing || saving}
          />

          <div className={"reconciliation-source-detail " + activeSource}>
            <span className="source-detail-icon" aria-hidden="true">
              {activeSource === "file" ? <UploadSourceIcon /> : <SyncSourceIcon />}
            </span>
            <div>
              <strong>
                {activeSource === "open-finance"
                  ? "Usar movimentações do Open Finance"
                  : activeSource === "file"
                    ? fileName || "Extrato selecionado"
                    : "Selecione uma origem para começar"}
              </strong>
              <small>
                {activeSource === "open-finance"
                  ? `Carrega automaticamente o feed de ${linkedBankAccounts.length} conta${linkedBankAccounts.length === 1 ? "" : "s"} bancária${linkedBankAccounts.length === 1 ? "" : "s"} vinculada${linkedBankAccounts.length === 1 ? "" : "s"}.`
                  : activeSource === "file" && parsed
                    ? `${parsed.format} • ${parsed.rows.length} movimentação${parsed.rows.length === 1 ? "" : "ões"} lida${parsed.rows.length === 1 ? "" : "s"}`
                    : "O Valora compara automaticamente os dados carregados com seus lançamentos."}
              </small>
            </div>
            {activeSource === "open-finance" && (
              <button
                type="button"
                className="primary"
                onClick={() => void loadOpenFinanceFeed()}
                disabled={loadingOpenFinance || saving}
              >
                {loadingOpenFinance ? "Atualizando..." : "Atualizar dados"}
              </button>
            )}
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
          <section className="reconciliation-premium-summary">
            <article className="total">
              <span className="summary-icon" aria-hidden="true">
                <LedgerIcon />
              </span>
              <div>
                <span>Movimentações lidas</span>
                <strong>{summary.total}</strong>
                <small>{parsed.format}</small>
              </div>
            </article>

            <article className="done">
              <span className="summary-icon" aria-hidden="true">
                <CheckCircleIcon />
              </span>
              <div>
                <span>Já conciliadas</span>
                <strong>{summary.already}</strong>
                <small>{reconciledPercent}% do total</small>
                <i><b style={{ width: `${reconciledPercent}%` }} /></i>
              </div>
            </article>

            <article className="match">
              <span className="summary-icon" aria-hidden="true">
                <TrendUpIcon />
              </span>
              <div>
                <span>Sugestões pendentes</span>
                <strong>{summary.match}</strong>
                <small>{matchPercent}% do total</small>
                <i><b style={{ width: `${matchPercent}%` }} /></i>
              </div>
            </article>

            <article className="create">
              <span className="summary-icon" aria-hidden="true">
                <PlusIcon />
              </span>
              <div>
                <span>A criar no Valora</span>
                <strong>{summary.create}</strong>
                <small>{createPercent}% do total</small>
                <i><b style={{ width: `${createPercent}%` }} /></i>
              </div>
            </article>
          </section>

          {hasTransactionConflict && (
            <div className="reconciliation-conflict">
              O mesmo lançamento foi associado a mais de uma linha. Escolha lançamentos diferentes antes de confirmar.
            </div>
          )}

          <section className="reconciliation-filter-bar">
            <label className="reconciliation-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por descrição, valor, data ou referência..."
              />
            </label>

            <div className="reconciliation-type-filters">
              <button
                type="button"
                className={typeFilter === "all" ? "active" : ""}
                onClick={() => setTypeFilter("all")}
              >
                Todos
              </button>
              <button
                type="button"
                className={typeFilter === "expense" ? "active expense" : "expense"}
                onClick={() => setTypeFilter("expense")}
              >
                Despesas
              </button>
              <button
                type="button"
                className={typeFilter === "income" ? "active income" : "income"}
                onClick={() => setTypeFilter("income")}
              >
                Receitas
              </button>
            </div>

            <select
              className="reconciliation-period-filter"
              value={periodFilter}
              onChange={(event) =>
                setPeriodFilter(event.target.value as "all" | "30" | "60" | "90")
              }
            >
              <option value="all">Todo o período</option>
              <option value="30">Últimos 30 dias</option>
              <option value="60">Últimos 60 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>

            <button
              type="button"
              className={showMoreFilters ? "ghost active reconciliation-more-filters" : "ghost reconciliation-more-filters"}
              onClick={() => setShowMoreFilters((current) => !current)}
            >
              Mais filtros
            </button>
          </section>

          {showMoreFilters && (
            <section className="reconciliation-advanced-filters">
              <span>Situação</span>
              {[
                ["all", "Todas"],
                ["done", "Conciliadas"],
                ["match", "Vincular existentes"],
                ["new", "Criar no Valora"],
                ["skip", "Ignoradas"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={situationFilter === value ? "active" : ""}
                  onClick={() =>
                    setSituationFilter(
                      value as "all" | "done" | "match" | "new" | "skip",
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </section>
          )}

          <section className="panel reconciliation-premium-table-panel">
            <div className="reconciliation-table-heading">
              <div>
                <h2>Extrato bancário</h2>
                <p>
                  {filteredRecommendations.length === recommendations.length
                    ? `${recommendations.length} movimentação${recommendations.length === 1 ? "" : "ões"} carregada${recommendations.length === 1 ? "" : "s"}`
                    : `${filteredRecommendations.length} de ${recommendations.length} movimentações exibidas`}
                </p>
              </div>
              <span className="reconciliation-source-badge">
                {parsed.format}
              </span>
            </div>

            <div className="table-scroll">
              <table className="reconciliation-premium-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th className="center">Tipo</th>
                    <th className="right">Valor</th>
                    <th className="center">Situação</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecommendations.map((recommendation) => {
                    const row = recommendation.row;
                    const choice = effectiveChoices[row.id];
                    const selectedCandidate = recommendation.candidates.find(
                      (candidate) => candidate.transaction.id === choice,
                    );
                    const situation =
                      recommendation.alreadyReconciled || choice === "__done__"
                        ? "done"
                        : choice === "__skip__"
                          ? "skip"
                          : choice === "__new__"
                            ? "new"
                            : "match";

                    return (
                      <tr
                        key={row.id}
                        className={recommendation.alreadyReconciled ? "reconciled" : ""}
                      >
                        <td>
                          <div className="reconciliation-date-cell">
                            <strong>{formatDate(row.date)}</strong>
                            <small>{parsed.format === "Open Finance" ? "Open Finance" : parsed.format}</small>
                          </div>
                        </td>
                        <td>
                          <div className="reconciliation-description-cell">
                            <span className="reconciliation-row-icon" aria-hidden="true">
                              <MovementIcon />
                            </span>
                            <div>
                              <strong>{row.description}</strong>
                              <small title={row.sourceId ?? undefined}>
                                {row.sourceId
                                  ? parsed.format === "Open Finance"
                                    ? `Ref. ${row.sourceId.slice(0, 34)}${row.sourceId.length > 34 ? "…" : ""}`
                                    : `FITID ${row.sourceId}`
                                  : "Sem referência externa"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td className="center">
                          <span className={`pill ${row.type}`}>
                            {row.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className={`right amount ${row.type}`}>
                          {row.type === "income" ? "+" : "−"} {money.format(row.amount)}
                        </td>
                        <td className="center">
                          <span className={`reconciliation-premium-status ${situation}`}>
                            <i aria-hidden="true" />
                            {situation === "done"
                              ? "Conciliada"
                              : situation === "skip"
                                ? "Ignorar"
                                : situation === "match"
                                  ? "Vincular"
                                  : "A conciliar"}
                          </span>
                        </td>
                        <td>
                          {recommendation.alreadyReconciled ? (
                            <div className="reconciliation-done-action">
                              <strong>Concluído</strong>
                              <small>Esta movimentação já foi conciliada.</small>
                            </div>
                          ) : (
                            <div className="reconciliation-match-cell premium">
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
                              <small>
                                {choice === "__new__"
                                  ? "Cria um novo lançamento ao confirmar."
                                  : choice === "__skip__"
                                    ? "A movimentação ficará fora desta conciliação."
                                    : selectedCandidate
                                      ? recommendation.confidence === "strong"
                                        ? "Sugestão forte por valor, data e descrição."
                                        : recommendation.confidence === "possible"
                                          ? "Sugestão automática. Revise antes de confirmar."
                                          : "Correspondência escolhida manualmente."
                                      : "Revise a ação antes de confirmar."}
                              </small>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredRecommendations.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="reconciliation-filter-empty">
                          <strong>Nenhuma movimentação encontrada</strong>
                          <span>Ajuste a busca ou os filtros para ver outros resultados.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="reconciliation-actions premium">
              <span>
                {summary.skip > 0
                  ? `${summary.skip} item${summary.skip === 1 ? "" : "s"} será${summary.skip === 1 ? "" : "ão"} ignorado${summary.skip === 1 ? "" : "s"}.`
                  : "Revise as sugestões antes de confirmar a conciliação."}
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
                  : summary.match + summary.create === 0 && summary.already === summary.total
                    ? "Tudo conciliado"
                    : `Confirmar ${summary.match + summary.create} item${summary.match + summary.create === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>

          {parsed.skipped > 0 && (
            <p className="reconciliation-footnote">
              {parsed.skipped} linha{parsed.skipped === 1 ? "" : "s"} foi{parsed.skipped === 1 ? "" : "ram"} ignorada{parsed.skipped === 1 ? "" : "s"} por dados inválidos ou incompletos.
            </p>
          )}
        </>
      )}

      {!parsed && (
        <section className="panel reconciliation-premium-empty">
          <span aria-hidden="true">↔</span>
          <strong>Escolha uma origem para começar</strong>
          <p>
            O Valora compara valor, data e descrição para encontrar correspondências e preparar a conciliação com segurança.
          </p>
        </section>
      )}
    </>
  );
}
