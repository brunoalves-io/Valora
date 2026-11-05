import type { StatementImportRow } from "./statementImport";

export type AutomationReconciliationRecord = {
  transaction_id: string;
  statement_reference: string | null;
  statement_date: string;
  statement_description: string;
  statement_amount: number | string;
  statement_type: "income" | "expense";
  reconciliation_mode?: "manual" | "automatic";
  automation_score?: number | null;
  automation_reason?: string | null;
};

export type CompanyLinkedBankAccount = {
  id: string;
  local_account_id: string | null;
  name: string;
};

export type CompanyBankMovement = {
  external_account_id: string;
  description: string;
  movement_type: "income" | "expense";
  amount: number | string;
  transaction_date: string;
};

export type SafeAutoMatchInput = {
  row: StatementImportRow;
  best: {
    id: string;
    description: string;
    transactionDate: string;
    score: number;
  } | null;
  secondScore: number | null;
  minimumScore: number;
  duplicateRisk: boolean;
  transferRisk: boolean;
};

export type SafeAutoMatchResult = {
  eligible: boolean;
  transactionId: string | null;
  score: number;
  reason: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((word) => word.length >= 3),
  );
}

function similarity(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union ? overlap / union : 0;
}

function daysApart(a: string, b: string) {
  const first = new Date(a + "T12:00:00Z").getTime();
  const second = new Date(b + "T12:00:00Z").getTime();
  if (!Number.isFinite(first) || !Number.isFinite(second)) return 999;
  return Math.round(Math.abs(first - second) / 86400000);
}

function sameAmount(a: number | string, b: number | string) {
  return Math.abs(Number(a) - Number(b)) <= 0.009;
}

function looksTransferLike(description: string) {
  const normalized = normalizeText(description);
  return [
    "pix",
    "transfer",
    "transf",
    "ted",
    "doc",
    "movimentacao entre contas",
    "entre contas",
    "conta propria",
  ].some((term) => normalized.includes(term));
}

export function openFinanceExternalAccountId(row: StatementImportRow) {
  const source = row.sourceId ?? "";
  if (!source.startsWith("pluggy:")) return null;
  const [, externalAccountId] = source.split(":");
  return externalAccountId || null;
}

export function detectPotentialDuplicate(
  row: StatementImportRow,
  reference: string,
  reconciliations: AutomationReconciliationRecord[],
) {
  const normalizedCurrent = normalizeText(row.description);

  return reconciliations.some((item) => {
    if (!item.statement_reference || item.statement_reference === reference) {
      return false;
    }

    if (item.statement_type !== row.type) return false;
    if (!sameAmount(item.statement_amount, row.amount)) return false;
    if (daysApart(item.statement_date, row.date) > 1) return false;

    const normalizedExisting = normalizeText(item.statement_description);
    if (
      normalizedCurrent &&
      normalizedExisting &&
      normalizedCurrent === normalizedExisting
    ) {
      return true;
    }

    return similarity(row.description, item.statement_description) >= 0.68;
  });
}

export function detectOwnAccountTransfer(
  row: StatementImportRow,
  currentLocalAccountId: string,
  linkedAccounts: CompanyLinkedBankAccount[],
  companyFeed: CompanyBankMovement[],
) {
  const sourceExternalAccountId = openFinanceExternalAccountId(row);
  if (!sourceExternalAccountId) return false;

  const sourceLink = linkedAccounts.find(
    (account) => account.id === sourceExternalAccountId,
  );

  if (
    !sourceLink?.local_account_id ||
    sourceLink.local_account_id !== currentLocalAccountId
  ) {
    return false;
  }

  return companyFeed.some((movement) => {
    if (movement.external_account_id === sourceExternalAccountId) return false;

    const counterpartLink = linkedAccounts.find(
      (account) => account.id === movement.external_account_id,
    );

    if (
      !counterpartLink?.local_account_id ||
      counterpartLink.local_account_id === currentLocalAccountId
    ) {
      return false;
    }

    if (movement.movement_type === row.type) return false;
    if (!sameAmount(movement.amount, row.amount)) return false;

    const distance = daysApart(movement.transaction_date, row.date);
    if (distance === 0) return true;
    if (distance > 1) return false;

    return (
      looksTransferLike(row.description) ||
      looksTransferLike(movement.description) ||
      similarity(row.description, movement.description) >= 0.45
    );
  });
}

export function evaluateSafeAutoMatch({
  row,
  best,
  secondScore,
  minimumScore,
  duplicateRisk,
  transferRisk,
}: SafeAutoMatchInput): SafeAutoMatchResult {
  if (!best) {
    return {
      eligible: false,
      transactionId: null,
      score: 0,
      reason: "Nenhum lançamento compatível encontrado.",
    };
  }

  if (duplicateRisk) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: "Possível duplicidade detectada.",
    };
  }

  if (transferRisk) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: "Possível transferência entre contas próprias.",
    };
  }

  const dateDistance = daysApart(best.transactionDate, row.date);
  const descriptionScore = similarity(row.description, best.description);
  const lead =
    secondScore === null ? Number.POSITIVE_INFINITY : best.score - secondScore;

  if (best.score < minimumScore) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: `Confiança ${best.score}% abaixo do mínimo de ${minimumScore}%.`,
    };
  }

  if (dateDistance > 1) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: "Datas distantes demais para automação.",
    };
  }

  if (descriptionScore < 0.7) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: "Descrição exige revisão humana.",
    };
  }

  if (Number.isFinite(lead) && lead < 15) {
    return {
      eligible: false,
      transactionId: null,
      score: best.score,
      reason: "Há mais de uma correspondência próxima.",
    };
  }

  return {
    eligible: true,
    transactionId: best.id,
    score: best.score,
    reason: `Mesmo valor, data próxima e descrição compatível (${best.score}%).`,
  };
}
