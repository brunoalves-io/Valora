export type CategoryOption = {
  id: string;
  name: string;
  type: "income" | "expense" | "both";
  active?: boolean;
};

export type CategorizationRule = {
  id: string;
  company_id: string;
  pattern: string;
  match_mode: "contains" | "starts_with" | "exact";
  transaction_type: "income" | "expense";
  category_id: string;
  priority: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CategorizedHistoryItem = {
  description: string;
  type: "income" | "expense";
  category_id: string | null;
};

export type CategorySuggestion = {
  categoryId: string;
  source: "rule" | "history";
  confidence: "strong" | "possible";
  score: number;
  reason: string;
  ruleId?: string;
};

const GENERIC_TOKENS = new Set([
  "pagamento",
  "pgto",
  "compra",
  "compras",
  "pix",
  "transferencia",
  "transferencias",
  "recebimento",
  "debito",
  "credito",
  "cartao",
  "ted",
  "doc",
  "boleto",
  "fatura",
  "lancamento",
  "transacao",
  "movimentacao",
  "estorno",
  "online",
  "brasil",
  "br",
]);

export function normalizeCategorizationText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string) {
  return normalizeCategorizationText(value)
    .split(" ")
    .filter(
      (word) =>
        word.length >= 3 &&
        !GENERIC_TOKENS.has(word) &&
        !/^\d+$/.test(word),
    );
}

export function categoryDescriptionSimilarity(a: string, b: string) {
  const leftWords = new Set(meaningfulWords(a));
  const rightWords = new Set(meaningfulWords(b));

  if (!leftWords.size || !rightWords.size) {
    const left = normalizeCategorizationText(a);
    const right = normalizeCategorizationText(b);
    return left && right && left === right && !GENERIC_TOKENS.has(left) ? 1 : 0;
  }

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }

  const union = new Set([...leftWords, ...rightWords]).size;
  return union ? overlap / union : 0;
}

export function rulePatternFromDescription(description: string) {
  const words = meaningfulWords(description);
  if (!words.length) return "";
  return words.slice(0, 4).join(" ");
}

export function isSafeRulePattern(pattern: string) {
  const normalized = normalizeCategorizationText(pattern);
  if (normalized.length < 3) return false;
  const words = meaningfulWords(normalized);
  return words.length > 0;
}

export function ruleMatchesDescription(
  description: string,
  rule: Pick<CategorizationRule, "pattern" | "match_mode">,
) {
  const descriptionNormalized = normalizeCategorizationText(description);
  const patternNormalized = normalizeCategorizationText(rule.pattern);
  if (!descriptionNormalized || !patternNormalized) return false;

  if (rule.match_mode === "exact") {
    return descriptionNormalized === patternNormalized;
  }

  if (rule.match_mode === "starts_with") {
    return descriptionNormalized.startsWith(patternNormalized);
  }

  return descriptionNormalized.includes(patternNormalized);
}

export function suggestCategory({
  description,
  type,
  categories,
  rules,
  history,
}: {
  description: string;
  type: "income" | "expense";
  categories: CategoryOption[];
  rules: CategorizationRule[];
  history: CategorizedHistoryItem[];
}): CategorySuggestion | null {
  const validCategories = new Map(
    categories
      .filter(
        (category) =>
          category.active !== false &&
          (category.type === type || category.type === "both"),
      )
      .map((category) => [category.id, category]),
  );

  const matchingRule = rules
    .filter(
      (rule) =>
        rule.active &&
        rule.transaction_type === type &&
        validCategories.has(rule.category_id) &&
        ruleMatchesDescription(description, rule),
    )
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (
        normalizeCategorizationText(b.pattern).length -
        normalizeCategorizationText(a.pattern).length
      );
    })[0];

  if (matchingRule) {
    return {
      categoryId: matchingRule.category_id,
      source: "rule",
      confidence: "strong",
      score: 100,
      reason: `Regra: “${matchingRule.pattern}”`,
      ruleId: matchingRule.id,
    };
  }

  const normalizedDescription = normalizeCategorizationText(description);
  const scores = new Map<
    string,
    { max: number; strongMatches: number; exactMatches: number }
  >();

  for (const item of history) {
    if (
      item.type !== type ||
      !item.category_id ||
      !validCategories.has(item.category_id)
    ) {
      continue;
    }

    const similarity = categoryDescriptionSimilarity(description, item.description);
    const exact =
      normalizedDescription.length >= 3 &&
      normalizedDescription === normalizeCategorizationText(item.description) &&
      meaningfulWords(description).length > 0;

    if (similarity < 0.35 && !exact) continue;

    const current = scores.get(item.category_id) ?? {
      max: 0,
      strongMatches: 0,
      exactMatches: 0,
    };

    current.max = Math.max(current.max, exact ? 1 : similarity);
    if (similarity >= 0.55) current.strongMatches += 1;
    if (exact) current.exactMatches += 1;
    scores.set(item.category_id, current);
  }

  const ranked = Array.from(scores.entries())
    .map(([categoryId, score]) => ({ categoryId, ...score }))
    .sort((a, b) => {
      if (b.max !== a.max) return b.max - a.max;
      if (b.exactMatches !== a.exactMatches) {
        return b.exactMatches - a.exactMatches;
      }
      return b.strongMatches - a.strongMatches;
    });

  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;

  const lead = second ? best.max - second.max : 1;
  const exactEnough = best.exactMatches >= 1;
  const repeatedEnough = best.strongMatches >= 2;

  if (
    (exactEnough && lead >= 0.08) ||
    (best.max >= 0.78 && repeatedEnough && lead >= 0.12)
  ) {
    return {
      categoryId: best.categoryId,
      source: "history",
      confidence: "strong",
      score: Math.round(best.max * 100),
      reason: exactEnough
        ? "Mesmo padrão já categorizado no histórico"
        : `Histórico semelhante (${Math.round(best.max * 100)}%)`,
    };
  }

  if (best.max >= 0.6 && repeatedEnough && lead >= 0.1) {
    return {
      categoryId: best.categoryId,
      source: "history",
      confidence: "possible",
      score: Math.round(best.max * 100),
      reason: `Sugestão pelo histórico (${Math.round(best.max * 100)}%)`,
    };
  }

  return null;
}
