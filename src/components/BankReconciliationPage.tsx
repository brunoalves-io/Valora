import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { CategorizationRulesDialog } from "./CategorizationRulesDialog";
import { InterfaceIcon } from "./InterfaceIcon";
import { StatusIcon } from "./StatusIcon";
import { OPEN_FINANCE_EMPTY_MESSAGE, reconciliationGuidance } from "./reconciliationGuidance";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import {
  parseStatementFile,
  type StatementImportRow,
  type StatementParseResult,
} from "../lib/statementImport";
import {
  rulePatternFromDescription,
  suggestCategory,
  type CategoryOption,
  type CategorizationRule,
  type CategorizedHistoryItem,
  type CategorySuggestion,
} from "../lib/categorization";
import {
  detectOwnAccountTransfer,
  detectPotentialDuplicate,
  evaluateSafeAutoMatch,
  type AutomationReconciliationRecord,
  type CompanyBankMovement,
  type CompanyLinkedBankAccount,
} from "../lib/reconciliationAutomation";

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
  category_id: string | null;
};

type Reconciliation = AutomationReconciliationRecord;

type LinkedBankAccount = {
  id: string;
  name: string;
  provider_account_id: string;
};

type AutomationSettings = {
  safe_auto_reconcile_enabled: boolean;
  minimum_auto_score: number;
  detect_duplicates: boolean;
  detect_transfers: boolean;
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
  return <InterfaceIcon name="link" />;
}

function UploadSourceIcon() {
  return <InterfaceIcon name="upload" />;
}

function SyncSourceIcon() {
  return <InterfaceIcon name="sync" />;
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
  return <StatusIcon kind="check" />;
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
  const autoRunKeyRef = useRef("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [linkedBankAccounts, setLinkedBankAccounts] = useState<LinkedBankAccount[]>([]);
  const [companyLinkedBankAccounts, setCompanyLinkedBankAccounts] = useState<CompanyLinkedBankAccount[]>([]);
  const [companyOpenFinanceFeed, setCompanyOpenFinanceFeed] = useState<CompanyBankMovement[]>([]);
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    safe_auto_reconcile_enabled: false,
    minimum_auto_score: 92,
    detect_duplicates: true,
    detect_transfers: true,
  });
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationSavingSettings, setAutomationSavingSettings] = useState(false);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categorizationRules, setCategorizationRules] = useState<CategorizationRule[]>([]);
  const [categorizedHistory, setCategorizedHistory] = useState<CategorizedHistoryItem[]>([]);
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [categoryChoices, setCategoryChoices] = useState<Record<string, string>>({});
  const [showRules, setShowRules] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<{
    pattern: string;
    transactionType: "income" | "expense";
    categoryId: string;
  } | null>(null);
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
    "all" | "done" | "match" | "new" | "review" | "skip"
  >("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = activeRole !== "viewer";
  const canManageRules = activeRole === "owner" || activeRole === "admin";

  async function loadCategorizationData() {
    if (!supabase || !activeCompany) return;

    const companyId = activeCompany.id;
    const [categoryResult, ruleResult, historyResult] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, type, active")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("bank_categorization_rules")
        .select("id, company_id, pattern, match_mode, transaction_type, category_id, priority, active, created_at, updated_at")
        .eq("company_id", companyId)
        .order("priority", { ascending: false })
        .order("updated_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("description, type, category_id")
        .eq("company_id", companyId)
        .eq("status", "paid")
        .not("category_id", "is", null)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(5000),
    ]);

    if (!categoryResult.error) {
      setCategories((categoryResult.data ?? []) as CategoryOption[]);
    }

    if (!ruleResult.error) {
      setCategorizationRules((ruleResult.data ?? []) as CategorizationRule[]);
    }

    if (!historyResult.error) {
      setCategorizedHistory((historyResult.data ?? []) as CategorizedHistoryItem[]);
    }
  }

  useEffect(() => {
    void loadCategorizationData();
  }, [activeCompany?.id]);

  async function loadAutomationSettings() {
    if (!supabase || !activeCompany) return;

    const { data, error: settingsError } = await supabase
      .from("bank_reconciliation_settings")
      .select("safe_auto_reconcile_enabled, minimum_auto_score, detect_duplicates, detect_transfers")
      .eq("company_id", activeCompany.id)
      .maybeSingle();

    if (settingsError) return;

    if (!data) {
      setAutomationSettings({
        safe_auto_reconcile_enabled: false,
        minimum_auto_score: 92,
        detect_duplicates: true,
        detect_transfers: true,
      });
      return;
    }

    setAutomationSettings({
      safe_auto_reconcile_enabled: Boolean(data.safe_auto_reconcile_enabled),
      minimum_auto_score: Number(data.minimum_auto_score) || 92,
      detect_duplicates: data.detect_duplicates !== false,
      detect_transfers: data.detect_transfers !== false,
    });
  }

  useEffect(() => {
    void loadAutomationSettings();
  }, [activeCompany?.id]);

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
          .select("id, description, amount, type, status, due_date, paid_at, account_id, category_id")
          .eq("company_id", companyId)
          .eq("account_id", accountId)
          .eq("status", "paid")
          .order("due_date", { ascending: false })
          .limit(2500),
        client
          .from("bank_reconciliations")
          .select("transaction_id, statement_reference, statement_date, statement_description, statement_amount, statement_type, reconciliation_mode, automation_score, automation_reason")
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
    setCategoryChoices({});
    setSearch("");
    setTypeFilter("all");
    setPeriodFilter("all");
    setSituationFilter("all");
    setShowMoreFilters(false);
    setExceptionsOnly(false);
    autoRunKeyRef.current = "";
    setCompanyOpenFinanceFeed([]);
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

  const automationAnalysis = useMemo(() => {
    const result: Record<
      string,
      {
        duplicateRisk: boolean;
        transferRisk: boolean;
        autoEligible: boolean;
        autoTransactionId: string | null;
        autoScore: number;
        reason: string;
        isException: boolean;
      }
    > = {};

    for (const recommendation of recommendations) {
      if (recommendation.alreadyReconciled) {
        result[recommendation.row.id] = {
          duplicateRisk: false,
          transferRisk: false,
          autoEligible: false,
          autoTransactionId: null,
          autoScore: 0,
          reason: "Movimentação já conciliada.",
          isException: false,
        };
        continue;
      }

      const duplicateRisk =
        automationSettings.detect_duplicates &&
        detectPotentialDuplicate(
          recommendation.row,
          recommendation.reference,
          reconciliations,
        );

      const transferRisk =
        parsed?.format === "Open Finance" &&
        automationSettings.detect_transfers &&
        detectOwnAccountTransfer(
          recommendation.row,
          accountId,
          companyLinkedBankAccounts,
          companyOpenFinanceFeed,
        );

      const defaultCandidate = recommendation.defaultChoice.startsWith("__")
        ? null
        : recommendation.candidates.find(
            (candidate) =>
              candidate.transaction.id === recommendation.defaultChoice,
          ) ?? null;

      const otherCandidate = recommendation.candidates.find(
        (candidate) =>
          candidate.transaction.id !== defaultCandidate?.transaction.id,
      );

      const safe = evaluateSafeAutoMatch({
        row: recommendation.row,
        best: defaultCandidate
          ? {
              id: defaultCandidate.transaction.id,
              description: defaultCandidate.transaction.description,
              transactionDate: transactionDate(defaultCandidate.transaction),
              score: defaultCandidate.score,
            }
          : null,
        secondScore: otherCandidate?.score ?? null,
        minimumScore: automationSettings.minimum_auto_score,
        duplicateRisk,
        transferRisk,
      });

      result[recommendation.row.id] = {
        duplicateRisk,
        transferRisk,
        autoEligible:
          parsed?.format === "Open Finance" && safe.eligible,
        autoTransactionId: safe.transactionId,
        autoScore: safe.score,
        reason: safe.reason,
        isException:
          duplicateRisk ||
          transferRisk ||
          !(parsed?.format === "Open Finance" && safe.eligible),
      };
    }

    return result;
  }, [
    recommendations,
    automationSettings,
    reconciliations,
    parsed?.format,
    accountId,
    companyLinkedBankAccounts,
    companyOpenFinanceFeed,
  ]);

  const effectiveChoices = useMemo(() => {
    const result: Record<string, string> = {};
    for (const recommendation of recommendations) {
      const rowId = recommendation.row.id;
      if (Object.prototype.hasOwnProperty.call(choices, rowId)) {
        result[rowId] = choices[rowId];
        continue;
      }

      const analysis = automationAnalysis[rowId];
      result[rowId] =
        analysis?.duplicateRisk || analysis?.transferRisk
          ? "__review__"
          : recommendation.defaultChoice;
    }
    return result;
  }, [choices, recommendations, automationAnalysis]);

  const transactionById = useMemo(
    () => new Map(transactions.map((transaction) => [transaction.id, transaction])),
    [transactions],
  );

  const reconciliationByReference = useMemo(
    () =>
      new Map(
        reconciliations
          .filter(
            (item): item is Reconciliation & { statement_reference: string } =>
              Boolean(item.statement_reference),
          )
          .map((item) => [item.statement_reference, item]),
      ),
    [reconciliations],
  );

  const categorySuggestions = useMemo(() => {
    const result: Record<string, CategorySuggestion | null> = {};

    for (const recommendation of recommendations) {
      result[recommendation.row.id] = suggestCategory({
        description: recommendation.row.description,
        type: recommendation.row.type,
        categories,
        rules: categorizationRules,
        history: categorizedHistory,
      });
    }

    return result;
  }, [recommendations, categories, categorizationRules, categorizedHistory]);

  const effectiveCategoryChoices = useMemo(() => {
    const result: Record<string, string> = {};

    for (const recommendation of recommendations) {
      const rowId = recommendation.row.id;
      const reconciliation = reconciliationByReference.get(
        recommendation.reference,
      );
      const transactionChoice = effectiveChoices[rowId];
      const targetTransactionId = recommendation.alreadyReconciled
        ? reconciliation?.transaction_id
        : transactionChoice && !transactionChoice.startsWith("__")
          ? transactionChoice
          : null;
      const existingCategoryId = targetTransactionId
        ? transactionById.get(targetTransactionId)?.category_id ?? ""
        : "";
      const suggestedCategoryId =
        categorySuggestions[rowId]?.categoryId ?? "";

      result[rowId] =
        Object.prototype.hasOwnProperty.call(categoryChoices, rowId)
          ? categoryChoices[rowId]
          : existingCategoryId || suggestedCategoryId;
    }

    return result;
  }, [
    recommendations,
    reconciliationByReference,
    effectiveChoices,
    transactionById,
    categorySuggestions,
    categoryChoices,
  ]);

  const categoryOnlyUpdates = useMemo(() => {
    return recommendations.filter((recommendation) => {
      if (!recommendation.alreadyReconciled) return false;
      const reconciliation = reconciliationByReference.get(
        recommendation.reference,
      );
      if (!reconciliation) return false;

      const existing =
        transactionById.get(reconciliation.transaction_id)?.category_id ?? "";
      const selected = effectiveCategoryChoices[recommendation.row.id] ?? "";
      return existing !== selected;
    });
  }, [
    recommendations,
    reconciliationByReference,
    transactionById,
    effectiveCategoryChoices,
  ]);

  const summary = useMemo(() => {
    const result = {
      total: recommendations.length,
      already: 0,
      match: 0,
      create: 0,
      review: 0,
      skip: 0,
    };

    for (const recommendation of recommendations) {
      const choice = effectiveChoices[recommendation.row.id];
      if (recommendation.alreadyReconciled || choice === "__done__") result.already += 1;
      else if (choice === "__skip__") result.skip += 1;
      else if (choice === "__review__") result.review += 1;
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

  const guidance = reconciliationGuidance({
    accountId, accountCount: accounts.length, loadingAccount, loadingOpenFinance,
    parsing, linkedCount: linkedBankAccounts.length,
    parsedRows: parsed ? parsed.rows.length : null, error,
  });

  const filteredRecommendations = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);
    const now = Date.now();

    return recommendations.filter((recommendation) => {
      const row = recommendation.row;
      const choice = effectiveChoices[row.id];

      const analysis = automationAnalysis[row.id];

      if (exceptionsOnly && !analysis?.isException) return false;

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
              : choice === "__review__"
                ? "review"
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
    exceptionsOnly,
    automationAnalysis,
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

  const reconciliationActionCount = summary.match + summary.create;
  const totalActionCount =
    reconciliationActionCount + categoryOnlyUpdates.length;

  const autoEligibleRecommendations = useMemo(
    () =>
      recommendations.filter((recommendation) => {
        if (recommendation.alreadyReconciled) return false;

        const analysis = automationAnalysis[recommendation.row.id];
        if (!analysis?.autoEligible) return false;

        const explicitChoice = choices[recommendation.row.id];
        return (
          !explicitChoice ||
          explicitChoice === analysis.autoTransactionId
        );
      }),
    [recommendations, automationAnalysis, choices],
  );

  const duplicateCount = useMemo(
    () =>
      recommendations.filter(
        (recommendation) =>
          automationAnalysis[recommendation.row.id]?.duplicateRisk,
      ).length,
    [recommendations, automationAnalysis],
  );

  const transferCount = useMemo(
    () =>
      recommendations.filter(
        (recommendation) =>
          automationAnalysis[recommendation.row.id]?.transferRisk,
      ).length,
    [recommendations, automationAnalysis],
  );

  const exceptionCount = useMemo(
    () =>
      recommendations.filter(
        (recommendation) =>
          !recommendation.alreadyReconciled &&
          automationAnalysis[recommendation.row.id]?.isException,
      ).length,
    [recommendations, automationAnalysis],
  );

  const automaticCompletedCount = useMemo(() => {
    const currentReferences = new Set(
      recommendations.map((recommendation) => recommendation.reference),
    );

    return reconciliations.filter(
      (item) =>
        item.reconciliation_mode === "automatic" &&
        item.statement_reference &&
        currentReferences.has(item.statement_reference),
    ).length;
  }, [recommendations, reconciliations]);

  function openRulesManager() {
    setRuleDraft(null);
    setShowRules(true);
  }

  async function updateAutomationSettings(
    patch: Partial<AutomationSettings>,
  ) {
    if (!supabase || !activeCompany || !canManageRules || automationSavingSettings) {
      return;
    }

    const next = { ...automationSettings, ...patch };
    setAutomationSavingSettings(true);
    setError("");

    const { data: userResult } = await supabase.auth.getUser();
    const userId = userResult.user?.id ?? null;

    const { error: settingsError } = await supabase
      .from("bank_reconciliation_settings")
      .upsert(
        {
          company_id: activeCompany.id,
          ...next,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" },
      );

    if (settingsError) {
      setError("Não foi possível salvar as configurações da automação segura.");
      setAutomationSavingSettings(false);
      return;
    }

    setAutomationSettings(next);
    autoRunKeyRef.current = "";
    setAutomationSavingSettings(false);
  }

  function createRuleFromRow(recommendation: Recommendation) {
    const pattern = rulePatternFromDescription(recommendation.row.description);
    const categoryId =
      effectiveCategoryChoices[recommendation.row.id] ?? "";

    if (!categoryId) {
      setError("Escolha uma categoria antes de criar uma regra.");
      return;
    }

    if (!pattern) {
      setError(
        "Esta descrição é genérica demais para virar regra automaticamente. Abra “Regras” e informe um padrão mais específico.",
      );
      return;
    }

    setRuleDraft({
      pattern,
      transactionType: recommendation.row.type,
      categoryId,
    });
    setShowRules(true);
    setError("");
  }

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

    const { data: companyAccountData, error: companyAccountError } = await supabase
      .from("bank_connection_accounts")
      .select("id, name, local_account_id")
      .eq("company_id", activeCompany.id)
      .not("local_account_id", "is", null)
      .order("name");

    if (companyAccountError) {
      setError("Não foi possível analisar as contas próprias conectadas.");
      setLoadingOpenFinance(false);
      return;
    }

    const companyAccounts =
      (companyAccountData ?? []) as CompanyLinkedBankAccount[];
    const companyExternalIds = companyAccounts.map((item) => item.id);

    if (!companyExternalIds.length) {
      setError("Nenhuma conta Open Finance vinculada foi encontrada.");
      setLoadingOpenFinance(false);
      return;
    }

    const { data, error: feedError } = await supabase
      .from("bank_connection_transactions")
      .select(
        "id, external_account_id, provider_transaction_id, description, movement_type, status, amount, transaction_date",
      )
      .eq("company_id", activeCompany.id)
      .in("external_account_id", companyExternalIds)
      .eq("status", "POSTED")
      .order("transaction_date", { ascending: false })
      .limit(10000);

    if (feedError) {
      setError("Não foi possível carregar as movimentações do Open Finance.");
      setLoadingOpenFinance(false);
      return;
    }

    const fullFeed = (data ?? []) as OpenFinanceTransaction[];
    const selectedExternalIds = new Set(
      linkedBankAccounts.map((item) => item.id),
    );
    const feed = fullFeed.filter((item) =>
      selectedExternalIds.has(item.external_account_id),
    );

    setCompanyLinkedBankAccounts(companyAccounts);
    setCompanyOpenFinanceFeed(fullFeed as CompanyBankMovement[]);
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
      setCategoryChoices({});
      setError(OPEN_FINANCE_EMPTY_MESSAGE);
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
    setCategoryChoices({});
    autoRunKeyRef.current = "";
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
      setCategoryChoices({});
      setCompanyOpenFinanceFeed([]);
      setCompanyLinkedBankAccounts([]);
      autoRunKeyRef.current = "";
    } catch (parseError) {
      setParsed(null);
      setFileName("");
      setChoices({});
      setCategoryChoices({});
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
        .select("id, description, amount, type, status, due_date, paid_at, account_id, category_id")
        .eq("company_id", companyId)
        .eq("account_id", accountId)
        .eq("status", "paid")
        .order("due_date", { ascending: false })
        .limit(2500),
      client
        .from("bank_reconciliations")
        .select("transaction_id, statement_reference, statement_date, statement_description, statement_amount, statement_type, reconciliation_mode, automation_score, automation_reason")
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

  async function runSafeAutomation() {
    if (
      !supabase ||
      !activeCompany ||
      !accountId ||
      !parsed ||
      parsed.format !== "Open Finance" ||
      !automationSettings.safe_auto_reconcile_enabled ||
      automationRunning ||
      schemaReady !== true ||
      !canManageRules
    ) {
      return;
    }

    const eligible = autoEligibleRecommendations;
    if (!eligible.length) return;

    setAutomationRunning(true);
    setError("");

    let completed = 0;
    let firstError = "";

    for (const recommendation of eligible) {
      const analysis = automationAnalysis[recommendation.row.id];
      const transactionId = analysis?.autoTransactionId;
      if (!analysis?.autoEligible || !transactionId) continue;

      const transaction = transactionById.get(transactionId);
      const categorySuggestion = categorySuggestions[recommendation.row.id];
      const categoryId =
        !transaction?.category_id && categorySuggestion?.source === "rule"
          ? categorySuggestion.categoryId
          : null;

      const { error: reconcileError } = await supabase.rpc(
        "reconcile_bank_statement_entry_v3",
        {
          p_company_id: activeCompany.id,
          p_account_id: accountId,
          p_transaction_id: transactionId,
          p_source_format: parsed.format,
          p_statement_reference: recommendation.reference,
          p_statement_date: recommendation.row.date,
          p_statement_description: recommendation.row.description,
          p_statement_amount: recommendation.row.amount,
          p_statement_type: recommendation.row.type,
          p_category_id: categoryId,
          p_reconciliation_mode: "automatic",
          p_automation_score: analysis.autoScore,
          p_automation_reason: analysis.reason,
        },
      );

      if (reconcileError) {
        firstError = reconcileError.message;
        break;
      }

      completed += 1;
    }

    await reloadReconciliations();
    await loadCategorizationData();

    if (completed > 0) {
      setSuccess(
        `${completed} movimentação${completed === 1 ? "" : "ões"} conciliada${completed === 1 ? "" : "s"} automaticamente com segurança.`,
      );
    }

    if (firstError) {
      setError(
        `A automação segura parou após ${completed} item${completed === 1 ? "" : "s"}. ${firstError}`,
      );
    }

    setAutomationRunning(false);
  }

  useEffect(() => {
    if (
      parsed?.format !== "Open Finance" ||
      !automationSettings.safe_auto_reconcile_enabled ||
      schemaReady !== true ||
      automationRunning ||
      saving ||
      !canManageRules ||
      autoEligibleRecommendations.length === 0
    ) {
      return;
    }

    const key = [
      accountId,
      automationSettings.minimum_auto_score,
      ...autoEligibleRecommendations.map(
        (recommendation) => recommendation.reference,
      ),
    ].join("|");

    if (autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;
    void runSafeAutomation();
  }, [
    parsed?.format,
    automationSettings.safe_auto_reconcile_enabled,
    automationSettings.minimum_auto_score,
    schemaReady,
    automationRunning,
    saving,
    canManageRules,
    accountId,
    autoEligibleRecommendations,
  ]);

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
      return (
        !recommendation.alreadyReconciled &&
        choice !== "__skip__" &&
        choice !== "__review__" &&
        choice !== "__done__"
      );
    });

    if (!pending.length && !categoryOnlyUpdates.length) {
      setError("Não há novas conciliações ou categorias para salvar.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    let completed = 0;
    let categoriesUpdated = 0;

    for (const recommendation of pending) {
      const choice = effectiveChoices[recommendation.row.id];
      const transactionId = choice === "__new__" ? null : choice;
      const categoryId =
        effectiveCategoryChoices[recommendation.row.id] || null;

      const { error: reconcileError } = await client.rpc(
        "reconcile_bank_statement_entry_v3",
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
          p_category_id: categoryId,
          p_reconciliation_mode: "manual",
          p_automation_score: null,
          p_automation_reason: null,
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

    for (const recommendation of categoryOnlyUpdates) {
      const reconciliation = reconciliationByReference.get(
        recommendation.reference,
      );
      if (!reconciliation) continue;

      const categoryId =
        effectiveCategoryChoices[recommendation.row.id] || null;

      const { error: categoryError } = await client
        .from("transactions")
        .update({
          category_id: categoryId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reconciliation.transaction_id)
        .eq("company_id", companyId);

      if (categoryError) {
        setError(
          `As conciliações foram preservadas, mas a atualização de categorias parou após ${categoriesUpdated} item${categoriesUpdated === 1 ? "" : "s"}.`,
        );
        setSaving(false);
        await reloadReconciliations();
        await loadCategorizationData();
        return;
      }

      categoriesUpdated += 1;
    }

    await reloadReconciliations();
    await loadCategorizationData();
    setChoices({});
    setCategoryChoices({});

    const messages = [];
    if (completed) {
      messages.push(
        `${completed} movimentação${completed === 1 ? "" : "ões"} conciliada${completed === 1 ? "" : "s"}`,
      );
    }
    if (categoriesUpdated) {
      messages.push(
        `${categoriesUpdated} categoria${categoriesUpdated === 1 ? "" : "s"} atualizada${categoriesUpdated === 1 ? "" : "s"}`,
      );
    }

    setSuccess(`${messages.join(" e ")} com sucesso.`);
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
        <div className="reconciliation-header-actions">
          <button
            type="button"
            className="ghost reconciliation-rules-button"
            onClick={openRulesManager}
          >
            <InterfaceIcon name="rules" />
            Regras
            {categorizationRules.length > 0 && (
              <span>{categorizationRules.length}</span>
            )}
          </button>
          <button
            type="button"
            className="ghost reconciliation-help-button"
            onClick={() => setShowHelp((current) => !current)}
            aria-expanded={showHelp}
            aria-controls={showHelp ? "reconciliation-help" : undefined}
          >
            <InterfaceIcon name="help" />
            Como funciona?
          </button>
        </div>
      </header>

      {showHelp && (
        <section className="reconciliation-help-panel" id="reconciliation-help" aria-label="Como funciona a conciliação">
          <div>
            <strong>1. Escolha a origem</strong>
            <span>Use o Open Finance ou carregue um extrato bancário.</span>
          </div>
          <div>
            <strong>2. Automação segura</strong>
            <span>Quando ativada, o Valora concilia apenas matches de alta confiança e registra a decisão como automática.</span>
          </div>
          <div>
            <strong>3. Revise as exceções</strong>
            <span>Duplicidades, transferências entre contas próprias e casos ambíguos ficam parados para revisão manual.</span>
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

      <section className="panel reconciliation-premium-setup" aria-label="Preparar conciliação">
        <div className="reconciliation-account-column">
          <div className="reconciliation-section-heading">
            <strong id="reconciliation-account-label"><b className="reconciliation-step-number" aria-hidden="true">1</b>Conta ou caixa</strong>
            <span id="reconciliation-account-help">Selecione a conta usada nesta conciliação</span>
          </div>

          <label className="reconciliation-account-select">
            <span className="reconciliation-account-icon" aria-hidden="true">
              <InterfaceIcon name="bank" />
            </span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={saving}
              aria-labelledby="reconciliation-account-label"
              aria-describedby="reconciliation-account-help"
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
            role="status"
            aria-atomic="true"
            aria-busy={loadingAccount}
            className={
              linkedBankAccounts.length && !loadingAccount && accountId
                ? "reconciliation-link-state connected"
                : "reconciliation-link-state"
            }
          >
            <span aria-hidden="true">
              {linkedBankAccounts.length && !loadingAccount && accountId ? <CheckCircleIcon /> : <StatusIcon kind="info" />}
            </span>
            <div>
              <strong>
                {!accountId ? "Selecione uma conta" : loadingAccount ? "Verificando vínculo com Open Finance" : linkedBankAccounts.length
                  ? "Conta vinculada ao Open Finance"
                  : "Conta sem vínculo com Open Finance"}
              </strong>
              <small>
                {!accountId ? "Escolha a conta para verificar as origens disponíveis." : loadingAccount ? "Consultando as contas bancárias vinculadas." : linkedBankAccounts.length
                  ? `${linkedBankAccounts.length} conta${linkedBankAccounts.length === 1 ? "" : "s"} bancária${linkedBankAccounts.length === 1 ? "" : "s"} conectada${linkedBankAccounts.length === 1 ? "" : "s"}`
                  : "Vincule uma conta em Conexões bancárias para usar o feed automático."}
              </small>
            </div>
          </div>
        </div>

        <div className="reconciliation-source-column">
          <div className="reconciliation-section-heading">
            <strong id="reconciliation-source-label"><b className="reconciliation-step-number" aria-hidden="true">2</b>Origem dos dados</strong>
            <span id="reconciliation-source-help">Escolha como carregar as movimentações</span>
          </div>

          <fieldset className="reconciliation-source-tabs" aria-labelledby="reconciliation-source-label" aria-describedby="reconciliation-source-help">
            <label className={"reconciliation-source-option" + (activeSource === "open-finance" ? " active" : "")}>
              <span className="source-tab-icon" aria-hidden="true">
                <BankSourceIcon />
              </span>
              <span>
                <strong id="reconciliation-open-finance-label">Open Finance</strong>
                <small id="reconciliation-open-finance-description">{!accountId ? "Selecione uma conta para verificar o vínculo" : loadingAccount ? "Verificando vínculo bancário" : linkedBankAccounts.length ? "Feed bancário conectado" : "Sem conta vinculada"}</small>
              </span>
              <input type="radio" name="reconciliation-source" value="open-finance"
                checked={activeSource === "open-finance"}
                aria-labelledby="reconciliation-open-finance-label"
                aria-describedby="reconciliation-open-finance-description"
                onClick={() => { if (activeSource === "open-finance") void loadOpenFinanceFeed(); }}
                onChange={() => { if (activeSource !== "open-finance") void loadOpenFinanceFeed(); }}
                onKeyDown={(event) => {
                  // A checked radio has no native Space activation; retain the existing refresh action.
                  if (event.key === " " && activeSource === "open-finance") {
                    event.preventDefault();
                    void loadOpenFinanceFeed();
                  }
                }}
                disabled={!accountId || !linkedBankAccounts.length || loadingAccount || loadingOpenFinance || parsing || saving} />
            </label>

            <label className={"reconciliation-source-option file" + (activeSource === "file" ? " active" : "")}>
              <span className="source-tab-icon" aria-hidden="true">
                <UploadSourceIcon />
              </span>
              <span>
                <strong id="reconciliation-file-label">{activeSource === "file" ? "Trocar extrato" : "Importar arquivo"}</strong>
                <small id="reconciliation-file-description">{accountId ? "CSV, Excel, ODS, OFX ou QFX" : "Selecione uma conta para importar o extrato"}</small>
              </span>
              <input type="radio" name="reconciliation-source" value="file"
                checked={activeSource === "file"}
                aria-labelledby="reconciliation-file-label" aria-describedby="reconciliation-file-description"
                onClick={() => { if (activeSource === "file") fileInputRef.current?.click(); }}
                onChange={() => { if (activeSource !== "file") fileInputRef.current?.click(); }}
                onKeyDown={(event) => {
                  if (event.key === " " && activeSource === "file") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                disabled={!accountId || loadingAccount || parsing || saving} />
            </label>
          </fieldset>

          <input
            ref={fileInputRef}
            className="reconciliation-hidden-file"
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.xlsb,.ods,.ofx,.qfx"
            onChange={handleFile}
            disabled={!accountId || loadingAccount || parsing || saving}
          />

          <div className={"reconciliation-source-detail " + activeSource} aria-busy={loadingOpenFinance}>
            <span className="source-detail-icon" aria-hidden="true">
              {activeSource === "file" ? <UploadSourceIcon /> : <SyncSourceIcon />}
            </span>
            <div>
              <span className="reconciliation-step-caption">3. Carregar movimentações</span>
              <strong>
                {activeSource === "open-finance"
                  ? "Usar movimentações do Open Finance"
                  : activeSource === "file"
                    ? fileName || "Extrato selecionado"
                    : accountId ? "Importar movimentações de um arquivo" : "Selecione uma conta para continuar"}
              </strong>
              <small>
                {activeSource === "open-finance"
                  ? `Use Atualizar dados para ler o feed de ${linkedBankAccounts.length} conta${linkedBankAccounts.length === 1 ? "" : "s"} bancária${linkedBankAccounts.length === 1 ? "" : "s"} vinculada${linkedBankAccounts.length === 1 ? "" : "s"}.`
                  : activeSource === "file" && parsed
                    ? `${parsed.format} • ${parsed.rows.length} movimentação${parsed.rows.length === 1 ? "" : "ões"} lida${parsed.rows.length === 1 ? "" : "s"}`
                    : accountId ? "Escolha Importar arquivo para abrir o extrato que deseja analisar." : "As origens disponíveis serão verificadas após a seleção da conta."}
              </small>
            </div>
            {activeSource === "open-finance" && (
              <button
                type="button"
                className="primary"
                onClick={() => void loadOpenFinanceFeed()}
                disabled={loadingAccount || loadingOpenFinance || saving}
              >
                {loadingOpenFinance ? "Atualizando..." : "Atualizar dados"}
              </button>
            )}
          </div>
        </div>
      </section>

      {loadingAccount && parsed && (
          <div className="reconciliation-loading" role="status">Analisando movimentações da conta...</div>
      )}

      {error && error !== OPEN_FINANCE_EMPTY_MESSAGE && <div className="form-alert error page-alert" role="alert">{error}</div>}
      {success && <div className="form-alert success page-alert" role="status">{success}</div>}
      <p className="reconciliation-status-announcement" role="status" aria-atomic="true">
        {parsed ? loadingOpenFinance ? "Carregando movimentações do Open Finance." : parsing ? "Lendo o extrato selecionado." : `${parsed.rows.length} movimentações carregadas de ${parsed.format}.` : ""}
      </p>

      {parsed && parsed.rows.length > 0 && (
        <div className="reconciliation-analysis-heading">
          <span className="reconciliation-step-caption">4. Analisar e conciliar</span>
          <strong>Revise as correspondências e exceções</strong>
        </div>
      )}
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

          {parsed.format === "Open Finance" && (
            <details className="reconciliation-automation-panel reconciliation-automation-disclosure">
              <summary className="reconciliation-automation-summary">
              <div className="reconciliation-automation-copy">
                <span className="reconciliation-automation-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3.5 19 6v5.25c0 4.35-2.75 7.55-7 9.25-4.25-1.7-7-4.9-7-9.25V6l7-2.5Z" />
                    <path d="m8.8 12.1 2.05 2.05 4.4-4.55" />
                  </svg>
                </span>
                <div>
                  <div className="reconciliation-automation-title">
                    <strong>Automação segura</strong>
                    <span className={automationSettings.safe_auto_reconcile_enabled ? "active" : ""}>
                      {automationRunning
                        ? "Executando"
                        : automationSettings.safe_auto_reconcile_enabled
                          ? "Ativa"
                          : "Desativada"}
                    </span>
                  </div>
                  <p>
                    Concilia sozinho apenas correspondências de alta confiança. Duplicidades,
                    transferências e casos ambíguos ficam para revisão.
                  </p>
                </div>
              </div>

                <span className="reconciliation-automation-expand">Configurar automação</span>
              </summary>
              <div className="reconciliation-automation-settings">
                <div className="reconciliation-automation-metrics">
                <div>
                  <strong>{automaticCompletedCount}</strong>
                  <span>automáticas</span>
                </div>
                <div>
                  <strong>{autoEligibleRecommendations.length}</strong>
                  <span>seguras agora</span>
                </div>
                <div>
                  <strong>{exceptionCount}</strong>
                  <span>para revisar</span>
                </div>
                <div className={duplicateCount ? "warning" : ""}>
                  <strong>{duplicateCount}</strong>
                  <span>duplicidades</span>
                </div>
                <div className={transferCount ? "info" : ""}>
                  <strong>{transferCount}</strong>
                  <span>transferências</span>
                </div>
              </div>

              <div className="reconciliation-automation-controls">
                <button
                  type="button"
                  role="switch"
                  aria-checked={automationSettings.safe_auto_reconcile_enabled}
                  className={
                    automationSettings.safe_auto_reconcile_enabled
                      ? "reconciliation-auto-switch active"
                      : "reconciliation-auto-switch"
                  }
                  onClick={() =>
                    void updateAutomationSettings({
                      safe_auto_reconcile_enabled:
                        !automationSettings.safe_auto_reconcile_enabled,
                    })
                  }
                  disabled={!canManageRules || automationSavingSettings || automationRunning}
                >
                  <i aria-hidden="true" />
                  <span>
                    {automationSettings.safe_auto_reconcile_enabled
                      ? "Ligada"
                      : "Desligada"}
                  </span>
                </button>

                <label>
                  Confiança mínima
                  <select
                    value={automationSettings.minimum_auto_score}
                    onChange={(event) =>
                      void updateAutomationSettings({
                        minimum_auto_score: Number(event.target.value),
                      })
                    }
                    disabled={!canManageRules || automationSavingSettings || automationRunning}
                  >
                    <option value={90}>90%</option>
                    <option value={92}>92%</option>
                    <option value={95}>95%</option>
                    <option value={98}>98%</option>
                  </select>
                </label>

                <label className="reconciliation-automation-check">
                  <input
                    type="checkbox"
                    checked={automationSettings.detect_duplicates}
                    onChange={(event) =>
                      void updateAutomationSettings({
                        detect_duplicates: event.target.checked,
                      })
                    }
                    disabled={!canManageRules || automationSavingSettings || automationRunning}
                  />
                  Detectar duplicidades
                </label>

                <label className="reconciliation-automation-check">
                  <input
                    type="checkbox"
                    checked={automationSettings.detect_transfers}
                    onChange={(event) =>
                      void updateAutomationSettings({
                        detect_transfers: event.target.checked,
                      })
                    }
                    disabled={!canManageRules || automationSavingSettings || automationRunning}
                  />
                  Detectar transferências
                </label>
              </div>
              </div>
            </details>
          )}

          {hasTransactionConflict && (
            <div className="reconciliation-conflict">
              O mesmo lançamento foi associado a mais de uma linha. Escolha lançamentos diferentes antes de confirmar.
            </div>
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

          <section className="reconciliation-filter-bar" aria-label="Filtros de movimentações">
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
              className={
                exceptionsOnly
                  ? "ghost active reconciliation-exceptions-filter"
                  : "ghost reconciliation-exceptions-filter"
              }
              onClick={() => setExceptionsOnly((current) => !current)}
              disabled={parsed.format !== "Open Finance"}
            >
              Revisar só exceções
              {exceptionCount > 0 && <span>{exceptionCount}</span>}
            </button>

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
                ["review", "Revisar"],
                ["skip", "Ignoradas"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={situationFilter === value ? "active" : ""}
                  onClick={() =>
                    setSituationFilter(
                      value as "all" | "done" | "match" | "new" | "review" | "skip",
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </section>
          )}


            <div className="table-scroll">
              <table className="reconciliation-premium-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th className="center">Tipo</th>
                    <th>Categoria</th>
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
                    const analysis = automationAnalysis[row.id];
                    const reconciliationRecord =
                      reconciliationByReference.get(recommendation.reference);
                    const automaticDone =
                      recommendation.alreadyReconciled &&
                      reconciliationRecord?.reconciliation_mode === "automatic";
                    const situation =
                      automaticDone
                        ? "automatic"
                        : recommendation.alreadyReconciled || choice === "__done__"
                          ? "done"
                          : analysis?.transferRisk
                            ? "transfer"
                            : analysis?.duplicateRisk
                              ? "duplicate"
                              : choice === "__skip__"
                                ? "skip"
                                : choice === "__review__"
                                  ? "review"
                                  : choice === "__new__"
                                    ? "new"
                                    : "match";
                    const selectedCategoryId =
                      effectiveCategoryChoices[row.id] ?? "";
                    const categorySuggestion =
                      categorySuggestions[row.id] ?? null;
                    const categoryOptions = categories.filter(
                      (category) =>
                        category.type === row.type ||
                        category.type === "both",
                    );
                    const safeRulePattern =
                      rulePatternFromDescription(row.description);

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
                        <td>
                          <div className="reconciliation-category-cell">
                            <select
                              value={selectedCategoryId}
                              onChange={(event) =>
                                setCategoryChoices((current) => ({
                                  ...current,
                                  [row.id]: event.target.value,
                                }))
                              }
                              disabled={saving || !canManage}
                            >
                              <option value="">Sem categoria</option>
                              {categoryOptions.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                </option>
                              ))}
                            </select>
                            <div className="reconciliation-category-meta">
                              {categorySuggestion &&
                                selectedCategoryId ===
                                  categorySuggestion.categoryId && (
                                  <span
                                    className={
                                      "category-suggestion-badge " +
                                      categorySuggestion.source
                                    }
                                    title={categorySuggestion.reason}
                                  >
                                    {categorySuggestion.source === "rule"
                                      ? "Regra"
                                      : categorySuggestion.confidence === "strong"
                                        ? `Histórico ${categorySuggestion.score}%`
                                        : `Sugestão ${categorySuggestion.score}%`}
                                  </span>
                                )}
                              {canManageRules &&
                                selectedCategoryId &&
                                categorySuggestion?.source !== "rule" &&
                                safeRulePattern && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      createRuleFromRow(recommendation)
                                    }
                                    disabled={saving}
                                  >
                                    Criar regra
                                  </button>
                                )}
                            </div>
                          </div>
                        </td>
                        <td className={`right amount ${row.type}`}>
                          {row.type === "income" ? "+" : "−"} {money.format(row.amount)}
                        </td>
                        <td className="center">
                          <span className={`reconciliation-premium-status ${situation}`}>
                            <i aria-hidden="true" />
                            {situation === "automatic"
                              ? "Automática"
                              : situation === "done"
                                ? "Conciliada"
                                : situation === "transfer"
                                  ? "Transferência?"
                                  : situation === "duplicate"
                                    ? "Duplicidade?"
                                    : situation === "review"
                                      ? "Revisar"
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
                              <strong>{automaticDone ? "Conciliada automaticamente" : "Concluído"}</strong>
                              <small>
                                {automaticDone
                                  ? `Automação segura${reconciliationRecord?.automation_score ? ` • ${reconciliationRecord.automation_score}%` : ""}`
                                  : "Esta movimentação já foi conciliada."}
                              </small>
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
                                {(analysis?.duplicateRisk || analysis?.transferRisk) && (
                                  <option value="__review__">
                                    Revisar antes de conciliar
                                  </option>
                                )}
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
                                {choice === "__review__"
                                  ? analysis?.transferRisk
                                    ? "Há uma movimentação oposta de mesmo valor em outra conta própria. Revise antes de tratar como receita ou despesa."
                                    : analysis?.duplicateRisk
                                      ? "Existe uma conciliação muito parecida. Revise para evitar duplicidade."
                                      : "Esta movimentação exige revisão."
                                  : choice === "__new__"
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
                      <td colSpan={7}>
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
                  totalActionCount === 0
                }
              >
                {saving
                  ? "Salvando..."
                  : totalActionCount === 0
                    ? summary.review > 0
                      ? `${summary.review} item${summary.review === 1 ? "" : "s"} para revisar`
                      : "Tudo conciliado"
                    : reconciliationActionCount === 0
                      ? `Salvar ${categoryOnlyUpdates.length} categoria${categoryOnlyUpdates.length === 1 ? "" : "s"}`
                      : categoryOnlyUpdates.length > 0
                        ? `Confirmar ${totalActionCount} alterações`
                        : `Confirmar ${reconciliationActionCount} item${reconciliationActionCount === 1 ? "" : "s"}`}
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

      <CategorizationRulesDialog
        open={showRules}
        categories={categories}
        rules={categorizationRules}
        canManage={canManageRules}
        initialDraft={ruleDraft}
        onClose={() => {
          setShowRules(false);
          setRuleDraft(null);
        }}
        onChanged={() => loadCategorizationData()}
      />

      {(!parsed || parsed.rows.length === 0) && (
        <section className="panel reconciliation-premium-empty" role="status" aria-atomic="true" data-state={guidance.state}>
          <span aria-hidden="true"><InterfaceIcon name="reconcile" /></span>
          <div>
            <span className="reconciliation-step-caption">4. Analisar e conciliar</span>
            <strong>{guidance.title}</strong>
            <p>{guidance.description}</p>
          </div>
        </section>
      )}
    </>
  );
}
