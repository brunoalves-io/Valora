import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  parseStatementFile,
  statementRowSignature,
  type StatementImportRow,
} from "../lib/statementImport";

type Account = {
  id: string;
  name: string;
};

type ImportRowState = StatementImportRow & {
  selected: boolean;
  duplicate: boolean;
};

type Props = {
  open: boolean;
  companyId: string;
  accounts: Account[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function StatementImportDialog({
  open,
  companyId,
  accounts,
  onClose,
  onImported,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<ImportRowState[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileFormat, setFileFormat] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) return;
    setAccountId((current) => current || accounts[0]?.id || "");
  }, [open, accounts]);

  useEffect(() => {
    if (open) return;
    setRows([]);
    setFileName("");
    setFileFormat("");
    setSkipped(0);
    setParsing(false);
    setCheckingDuplicates(false);
    setImporting(false);
    setError("");
    setSuccess("");
  }, [open]);

  useEffect(() => {
    if (!open || !accountId || rows.length === 0 || !supabase) return;

    const client = supabase;
    let cancelled = false;

    async function checkDuplicates() {
      setCheckingDuplicates(true);

      const dates = rows.map((row) => row.date).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      const { data, error: queryError } = await client
        .from("transactions")
        .select("description, amount, type, due_date")
        .eq("company_id", companyId)
        .eq("account_id", accountId)
        .gte("due_date", minDate)
        .lte("due_date", maxDate);

      if (cancelled) return;

      if (queryError) {
        setError("Não foi possível verificar lançamentos duplicados.");
        setCheckingDuplicates(false);
        return;
      }

      const existing = new Set(
        (data ?? []).map((item) =>
          statementRowSignature({
            date: item.due_date,
            description: item.description,
            amount: item.amount,
            type: item.type,
          }),
        ),
      );

      setRows((current) =>
        current.map((row) => {
          const duplicate = existing.has(statementRowSignature(row));
          return {
            ...row,
            duplicate,
            selected: duplicate ? false : row.selected,
          };
        }),
      );

      setCheckingDuplicates(false);
    }

    void checkDuplicates();

    return () => {
      cancelled = true;
    };
  }, [open, accountId, companyId, rows.length]);

  const selectedCount = useMemo(
    () => rows.filter((row) => row.selected && !row.duplicate).length,
    [rows],
  );

  const duplicateCount = useMemo(
    () => rows.filter((row) => row.duplicate).length,
    [rows],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (result, row) => {
        if (!row.selected || row.duplicate) return result;
        if (row.type === "income") result.income += row.amount;
        else result.expense += row.amount;
        return result;
      },
      { income: 0, expense: 0 },
    );
  }, [rows]);

  if (!open) return null;

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParsing(true);
    setError("");
    setSuccess("");

    try {
      const result = await parseStatementFile(file);
      setFileName(file.name);
      setFileFormat(result.format);
      setSkipped(result.skipped);
      setRows(
        result.rows.map((row) => ({
          ...row,
          selected: true,
          duplicate: false,
        })),
      );
    } catch (parseError) {
      setRows([]);
      setFileName("");
      setFileFormat("");
      setSkipped(0);
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Não foi possível ler este arquivo.",
      );
    } finally {
      setParsing(false);
    }
  }

  function toggleRow(id: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id && !row.duplicate
          ? { ...row, selected: !row.selected }
          : row,
      ),
    );
  }

  function toggleAll() {
    const selectable = rows.filter((row) => !row.duplicate);
    const allSelected = selectable.length > 0 && selectable.every((row) => row.selected);

    setRows((current) =>
      current.map((row) =>
        row.duplicate ? row : { ...row, selected: !allSelected },
      ),
    );
  }

  async function importSelected() {
    if (!supabase || !companyId) return;

    if (!accountId) {
      setError("Escolha a conta ou caixa que receberá o extrato.");
      return;
    }

    const selected = rows.filter((row) => row.selected && !row.duplicate);
    if (!selected.length) {
      setError("Selecione pelo menos um lançamento para importar.");
      return;
    }

    setImporting(true);
    setError("");
    setSuccess("");

    const payload = selected.map((row) => ({
      company_id: companyId,
      type: row.type,
      description: row.description,
      amount: row.amount,
      due_date: row.date,
      status: "paid",
      paid_at: `${row.date}T12:00:00.000Z`,
      account_id: accountId,
      category_id: null,
      cost_center_id: null,
      partner_id: null,
    }));

    for (let index = 0; index < payload.length; index += 300) {
      const chunk = payload.slice(index, index + 300);
      const { error: insertError } = await supabase
        .from("transactions")
        .insert(chunk);

      if (insertError) {
        setError(
          "A importação foi interrompida. Revise os lançamentos antes de tentar novamente.",
        );
        setImporting(false);
        return;
      }
    }

    await onImported();
    setRows((current) =>
      current.map((row) =>
        row.selected && !row.duplicate
          ? { ...row, duplicate: true, selected: false }
          : row,
      ),
    );
    setSuccess(
      `${selected.length} lançamento${selected.length === 1 ? "" : "s"} importado${selected.length === 1 ? "" : "s"} com sucesso.`,
    );
    setImporting(false);
  }

  return (
    <div className="statement-import-backdrop" role="presentation">
      <section
        className="statement-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-import-title"
      >
        <header className="statement-import-header">
          <div>
            <span>IMPORTAÇÃO DE EXTRATO</span>
            <h2 id="statement-import-title">Importar movimentações bancárias</h2>
            <p>
              Revise os lançamentos antes de gravar. Itens já encontrados na mesma conta são ignorados.
            </p>
          </div>
          <button
            type="button"
            className="statement-import-close"
            onClick={onClose}
            aria-label="Fechar importação"
            disabled={importing}
          >
            ×
          </button>
        </header>

        <div className="statement-import-body">
          <div className="statement-import-controls">
            <label>
              Conta ou caixa
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                disabled={importing}
              >
                <option value="">Selecione</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="statement-file-picker">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.xlsb,.ods,.ofx,.qfx"
                onChange={handleFile}
                disabled={parsing || importing}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => inputRef.current?.click()}
                disabled={parsing || importing}
              >
                {parsing ? "Lendo arquivo..." : fileName ? "Trocar arquivo" : "Selecionar arquivo"}
              </button>
              <div>
                <strong>{fileName || "CSV, Excel ou OFX"}</strong>
                <small>
                  {fileName
                    ? `${fileFormat} • ${rows.length} lançamento${rows.length === 1 ? "" : "s"} encontrado${rows.length === 1 ? "" : "s"}`
                    : "Aceita CSV, XLS/XLSX, ODS, OFX e QFX"}
                </small>
              </div>
            </div>
          </div>

          {accounts.length === 0 && (
            <div className="form-alert error">
              Crie pelo menos uma conta ou caixa antes de importar um extrato.
            </div>
          )}

          {error && <div className="form-alert error">{error}</div>}
          {success && <div className="form-alert success">{success}</div>}

          {rows.length > 0 && (
            <>
              <div className="statement-import-summary">
                <div>
                  <span>Selecionados</span>
                  <strong>{selectedCount}</strong>
                </div>
                <div>
                  <span>Entradas</span>
                  <strong className="income">{money.format(totals.income)}</strong>
                </div>
                <div>
                  <span>Saídas</span>
                  <strong className="expense">{money.format(totals.expense)}</strong>
                </div>
                <div>
                  <span>Duplicados</span>
                  <strong>{checkingDuplicates ? "..." : duplicateCount}</strong>
                </div>
              </div>

              <div className="statement-import-table-wrap">
                <table className="statement-import-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos"
                          checked={
                            rows.some((row) => !row.duplicate) &&
                            rows.filter((row) => !row.duplicate).every((row) => row.selected)
                          }
                          onChange={toggleAll}
                        />
                      </th>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Tipo</th>
                      <th className="right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.duplicate ? "duplicate" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={row.duplicate || importing}
                            onChange={() => toggleRow(row.id)}
                            aria-label={`Selecionar ${row.description}`}
                          />
                        </td>
                        <td>
                          {new Date(row.date + "T12:00:00").toLocaleDateString("pt-BR")}
                        </td>
                        <td>
                          <strong>{row.description}</strong>
                          {row.duplicate && <small>Já existe nesta conta</small>}
                        </td>
                        <td>
                          <span className={`pill ${row.type}`}>
                            {row.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className={`right amount ${row.type}`}>
                          {row.type === "income" ? "+" : "−"} {money.format(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(skipped > 0 || checkingDuplicates) && (
                <p className="statement-import-note">
                  {checkingDuplicates
                    ? "Verificando possíveis duplicados..."
                    : `${skipped} linha${skipped === 1 ? "" : "s"} ignorada${skipped === 1 ? "" : "s"} por falta de dados válidos.`}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="statement-import-actions">
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            disabled={importing}
          >
            {success ? "Concluir" : "Cancelar"}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void importSelected()}
            disabled={
              importing ||
              parsing ||
              checkingDuplicates ||
              !accountId ||
              selectedCount === 0
            }
          >
            {importing
              ? "Importando..."
              : `Importar ${selectedCount || ""} lançamento${selectedCount === 1 ? "" : "s"}`.trim()}
          </button>
        </footer>
      </section>
    </div>
  );
}
