import * as XLSX from "@stackline/xlsx";

export type StatementImportType = "income" | "expense";

export type StatementImportRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: StatementImportType;
  sourceId?: string;
};

export type StatementParseResult = {
  format: "CSV" | "Excel" | "OFX";
  rows: StatementImportRow[];
  skipped: number;
};

const DATE_KEYS = [
  "data",
  "date",
  "dt",
  "datalancamento",
  "datamovimento",
  "datadomovimento",
  "postingdate",
  "transactiondate",
  "dataoperacao",
];

const DESCRIPTION_KEYS = [
  "descricao",
  "description",
  "historico",
  "memo",
  "name",
  "nome",
  "detalhes",
  "estabelecimento",
  "favorecido",
  "lancamento",
];

const AMOUNT_KEYS = [
  "valor",
  "amount",
  "montante",
  "total",
  "valortransacao",
  "valormovimento",
  "valorbrl",
];

const CREDIT_KEYS = ["credito", "credit", "entrada", "receita", "valorcredito"];
const DEBIT_KEYS = ["debito", "debit", "saida", "despesa", "valordebito"];
const TYPE_KEYS = ["tipo", "type", "natureza", "operacao", "movimento"];

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(keys: string[], aliases: string[]) {
  const normalized = keys.map((key) => ({ key, normalized: normalizeKey(key) }));

  for (const alias of aliases) {
    const exact = normalized.find((item) => item.normalized === alias);
    if (exact) return exact.key;
  }

  for (const alias of aliases) {
    const partial = normalized.find(
      (item) => item.normalized.startsWith(alias) || item.normalized.includes(alias),
    );
    if (partial) return partial.key;
  }

  return null;
}

function parseNumericValue(raw: unknown) {
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined) return NaN;

  let text = String(raw).trim();
  if (!text) return NaN;

  const negativeByParentheses = /^\(.*\)$/.test(text);
  text = text
    .replace(/[R$€£\s]/g, "")
    .replace(/[()]/g, "")
    .replace(/[^0-9,.-]/g, "");

  if (!text) return NaN;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    const parts = text.split(",");
    if (parts.length > 2) {
      const decimal = parts.pop();
      text = parts.join("") + "." + decimal;
    } else {
      text = text.replace(",", ".");
    }
  } else if ((text.match(/\./g) ?? []).length > 1) {
    const parts = text.split(".");
    const decimal = parts.pop();
    text = parts.join("") + "." + decimal;
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return NaN;
  return negativeByParentheses ? -Math.abs(value) : value;
}

function toIsoDate(raw: unknown) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }

  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(raw * 86400000));
    return date.toISOString().slice(0, 10);
  }

  const text = String(raw ?? "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const br = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (br) {
    let [, day, month, year] = br;
    if (year.length === 2) year = Number(year) >= 70 ? `19${year}` : `20${year}`;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function typeFromText(raw: unknown): StatementImportType | null {
  const text = normalizeKey(String(raw ?? ""));
  if (!text) return null;

  if (
    text === "d" ||
    text.includes("debito") ||
    text.includes("debit") ||
    text.includes("saida") ||
    text.includes("despesa")
  ) {
    return "expense";
  }

  if (
    text === "c" ||
    text.includes("credito") ||
    text.includes("credit") ||
    text.includes("entrada") ||
    text.includes("receita")
  ) {
    return "income";
  }

  return null;
}

function normalizeTabularRows(records: Record<string, unknown>[]) {
  if (!records.length) {
    throw new Error("A planilha não contém lançamentos para importar.");
  }

  const keys = Array.from(
    new Set(records.flatMap((record) => Object.keys(record))),
  );

  const dateKey = findColumn(keys, DATE_KEYS);
  const descriptionKey = findColumn(keys, DESCRIPTION_KEYS);
  const amountKey = findColumn(keys, AMOUNT_KEYS);
  const creditKey = findColumn(keys, CREDIT_KEYS);
  const debitKey = findColumn(keys, DEBIT_KEYS);
  const typeKey = findColumn(keys, TYPE_KEYS);

  if (!dateKey || !descriptionKey || (!amountKey && !creditKey && !debitKey)) {
    throw new Error(
      "Não consegui identificar automaticamente Data, Descrição e Valor. Use cabeçalhos como Data, Descrição e Valor, ou colunas separadas Crédito e Débito.",
    );
  }

  const rows: StatementImportRow[] = [];
  let skipped = 0;

  records.forEach((record, index) => {
    const date = toIsoDate(record[dateKey]);
    const description = String(record[descriptionKey] ?? "").trim();

    let signedAmount = amountKey ? parseNumericValue(record[amountKey]) : NaN;
    let type = typeKey ? typeFromText(record[typeKey]) : null;

    if (!Number.isFinite(signedAmount)) {
      const credit = creditKey ? parseNumericValue(record[creditKey]) : NaN;
      const debit = debitKey ? parseNumericValue(record[debitKey]) : NaN;

      if (Number.isFinite(credit) && Math.abs(credit) > 0) {
        signedAmount = Math.abs(credit);
        type = "income";
      } else if (Number.isFinite(debit) && Math.abs(debit) > 0) {
        signedAmount = -Math.abs(debit);
        type = "expense";
      }
    }

    if (!date || !description || !Number.isFinite(signedAmount) || signedAmount === 0) {
      skipped += 1;
      return;
    }

    if (!type) type = signedAmount < 0 ? "expense" : "income";

    rows.push({
      id: `tabular-${index}-${date}-${Math.abs(signedAmount)}`,
      date,
      description,
      amount: Math.abs(signedAmount),
      type,
    });
  });

  if (!rows.length) {
    throw new Error("Nenhum lançamento válido foi encontrado no arquivo.");
  }

  return { rows, skipped };
}


function countDelimiterOutsideQuotes(line: string, delimiter: string) {
  let quoted = false;
  let count = 0;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimitedSeparator(text: string) {
  const firstLine =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? "";

  const candidates = [";", "\t", ","];
  const scored = candidates
    .map((delimiter) => ({
      delimiter,
      count: countDelimiterOutsideQuotes(firstLine, delimiter),
    }))
    .sort((a, b) => b.count - a.count);

  if (!scored[0] || scored[0].count === 0) {
    throw new Error(
      "Não consegui identificar o separador do CSV. Use um arquivo com colunas separadas por ponto e vírgula, vírgula ou tabulação.",
    );
  }

  return scored[0].delimiter;
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";

      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);

  return rows;
}

function parseDelimitedText(text: string) {
  const cleanText = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimitedSeparator(cleanText);
  const rows = parseDelimitedRows(cleanText, delimiter);

  if (rows.length < 2) {
    throw new Error("O CSV não contém lançamentos para importar.");
  }

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new Error("O CSV possui uma ou mais colunas sem nome.");
  }

  return rows.slice(1).map((values) => {
    const record: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() ?? "";
    });

    return record;
  });
}

function readOfxTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function parseOfx(text: string): StatementParseResult {
  const normalized = text.replace(/\r/g, "");
  const blocks = Array.from(
    normalized.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi),
  );

  const rows: StatementImportRow[] = [];
  let skipped = 0;

  blocks.forEach((match, index) => {
    const block = match[1];
    const rawDate = readOfxTag(block, "DTPOSTED") || readOfxTag(block, "DTUSER");
    const rawAmount = readOfxTag(block, "TRNAMT");
    const name = readOfxTag(block, "NAME");
    const memo = readOfxTag(block, "MEMO");
    const fitid = readOfxTag(block, "FITID");

    const date = toIsoDate(rawDate);
    const signedAmount = parseNumericValue(rawAmount);
    const description = [name, memo]
      .filter(Boolean)
      .filter((value, idx, array) => array.indexOf(value) === idx)
      .join(" • ")
      .trim();

    if (!date || !description || !Number.isFinite(signedAmount) || signedAmount === 0) {
      skipped += 1;
      return;
    }

    rows.push({
      id: fitid || `ofx-${index}-${date}-${Math.abs(signedAmount)}`,
      sourceId: fitid || undefined,
      date,
      description,
      amount: Math.abs(signedAmount),
      type: signedAmount < 0 ? "expense" : "income",
    });
  });

  if (!rows.length) {
    throw new Error("O arquivo OFX não contém movimentações bancárias válidas.");
  }

  return { format: "OFX", rows, skipped };
}

export async function parseStatementFile(file: File): Promise<StatementParseResult> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".ofx") || lowerName.endsWith(".qfx")) {
    return parseOfx(await file.text());
  }

  if (
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".tsv")
  ) {
    const records = parseDelimitedText(await file.text());
    return {
      format: "CSV",
      ...normalizeTabularRows(records),
    };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Não encontrei uma planilha no arquivo.");

  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });

  return {
    format: "Excel",
    ...normalizeTabularRows(records),
  };
}

export function statementRowSignature(row: {
  date: string;
  description: string;
  amount: number | string;
  type: StatementImportType;
}) {
  const description = row.description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return [
    row.date,
    row.type,
    Number(row.amount).toFixed(2),
    description,
  ].join("|");
}
