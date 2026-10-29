import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { supabase } from "../lib/supabase";

export type OrganizerTransaction = {
  id: string;
  description: string;
};

type TransactionTag = {
  id: string;
  name: string;
};

type TransactionAttachment = {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | string;
  created_at: string;
};

type Props = {
  open: boolean;
  companyId: string;
  transaction: OrganizerTransaction | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

const allowedExtensions = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

const fallbackMimeByExtension: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function safeFileName(name: string) {
  const extension = fileExtension(name);
  const base = name
    .slice(0, extension ? -(extension.length + 1) : undefined)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return extension ? `${base || "arquivo"}.${extension}` : base || "arquivo";
}

function formatBytes(value: number | string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
}

export function TransactionOrganizerDialog({
  open,
  companyId,
  transaction,
  canManage,
  onClose,
  onChanged,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tags, setTags] = useState<TransactionTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<TransactionAttachment[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingTag, setSavingTag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const selectedTags = useMemo(
    () => tags.filter((tag) => selectedTagIds.has(tag.id)),
    [tags, selectedTagIds],
  );

  async function load() {
    if (!supabase || !transaction || !companyId) return;

    setLoading(true);
    setError("");

    const [tagResult, linkResult, attachmentResult] = await Promise.all([
      supabase
        .from("transaction_tags")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("transaction_tag_links")
        .select("tag_id")
        .eq("company_id", companyId)
        .eq("transaction_id", transaction.id),
      supabase
        .from("transaction_attachments")
        .select("id, file_name, file_path, mime_type, file_size, created_at")
        .eq("company_id", companyId)
        .eq("transaction_id", transaction.id)
        .order("created_at", { ascending: false }),
    ]);

    const firstError = tagResult.error || linkResult.error || attachmentResult.error;

    if (firstError) {
      const message = firstError.message.toLowerCase();
      const missingSchema =
        firstError.code === "42P01" ||
        message.includes("transaction_tags") ||
        message.includes("transaction_tag_links") ||
        message.includes("transaction_attachments");

      if (missingSchema) {
        setSchemaReady(false);
        setTags([]);
        setSelectedTagIds(new Set());
        setAttachments([]);
      } else {
        setError(firstError.message);
      }

      setLoading(false);
      return;
    }

    setSchemaReady(true);
    setTags((tagResult.data ?? []) as TransactionTag[]);
    setSelectedTagIds(
      new Set(
        ((linkResult.data ?? []) as Array<{ tag_id: string }>).map((item) => item.tag_id),
      ),
    );
    setAttachments((attachmentResult.data ?? []) as TransactionAttachment[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    setNewTag("");
    void load();
  }, [open, transaction?.id, companyId]);

  async function toggleTag(tagId: string) {
    if (!supabase || !transaction || !canManage || schemaReady !== true) return;

    setError("");
    const selected = selectedTagIds.has(tagId);

    const result = selected
      ? await supabase
          .from("transaction_tag_links")
          .delete()
          .eq("company_id", companyId)
          .eq("transaction_id", transaction.id)
          .eq("tag_id", tagId)
      : await supabase.from("transaction_tag_links").insert({
          company_id: companyId,
          transaction_id: transaction.id,
          tag_id: tagId,
        });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (selected) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    await onChanged();
  }

  async function createTag() {
    if (!supabase || !transaction || !canManage || schemaReady !== true) return;

    const name = newTag.trim();
    if (!name) return;
    if (name.length > 40) {
      setError("A tag pode ter no máximo 40 caracteres.");
      return;
    }

    setSavingTag(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("transaction_tags")
      .insert({
        company_id: companyId,
        name,
      })
      .select("id, name")
      .single();

    let tag = data as TransactionTag | null;

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: existing, error: lookupError } = await supabase
          .from("transaction_tags")
          .select("id, name")
          .eq("company_id", companyId)
          .ilike("name", name)
          .limit(1)
          .maybeSingle();

        if (lookupError || !existing) {
          setError(lookupError?.message || "Essa tag já existe.");
          setSavingTag(false);
          return;
        }

        tag = existing as TransactionTag;
      } else {
        setError(insertError.message);
        setSavingTag(false);
        return;
      }
    }

    if (!tag) {
      setSavingTag(false);
      return;
    }

    if (!selectedTagIds.has(tag.id)) {
      const { error: linkError } = await supabase.from("transaction_tag_links").insert({
        company_id: companyId,
        transaction_id: transaction.id,
        tag_id: tag.id,
      });

      if (linkError && linkError.code !== "23505") {
        setError(linkError.message);
        setSavingTag(false);
        return;
      }
    }

    setNewTag("");
    setSavingTag(false);
    await load();
    await onChanged();
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!supabase || !transaction || !canManage || schemaReady !== true || !files.length) {
      return;
    }

    setUploading(true);
    setError("");

    for (const file of files) {
      const extension = fileExtension(file.name);

      if (!allowedExtensions.has(extension)) {
        setError(`O arquivo “${file.name}” possui um formato não permitido.`);
        setUploading(false);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError(`O arquivo “${file.name}” ultrapassa o limite de 10 MB.`);
        setUploading(false);
        return;
      }

      const mimeType = file.type || fallbackMimeByExtension[extension] || "application/pdf";
      const filePath = `${companyId}/${transaction.id}/${crypto.randomUUID()}-${safeFileName(
        file.name,
      )}`;

      const { error: uploadError } = await supabase.storage
        .from("transaction-attachments")
        .upload(filePath, file, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        setError(uploadError.message);
        setUploading(false);
        return;
      }

      const { error: metadataError } = await supabase
        .from("transaction_attachments")
        .insert({
          company_id: companyId,
          transaction_id: transaction.id,
          file_name: file.name,
          file_path: filePath,
          mime_type: mimeType,
          file_size: file.size,
        });

      if (metadataError) {
        await supabase.storage.from("transaction-attachments").remove([filePath]);
        setError(metadataError.message);
        setUploading(false);
        return;
      }
    }

    setUploading(false);
    await load();
    await onChanged();
  }

  async function downloadAttachment(attachment: TransactionAttachment) {
    if (!supabase) return;

    setError("");
    const { data, error: downloadError } = await supabase.storage
      .from("transaction-attachments")
      .download(attachment.file_path);

    if (downloadError || !data) {
      setError(downloadError?.message || "Não foi possível baixar o arquivo.");
      return;
    }

    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function removeAttachment(attachment: TransactionAttachment) {
    if (!supabase || !canManage || schemaReady !== true) return;

    setRemovingAttachmentId(attachment.id);
    setError("");

    const { error: storageError } = await supabase.storage
      .from("transaction-attachments")
      .remove([attachment.file_path]);

    if (storageError) {
      setError(storageError.message);
      setRemovingAttachmentId(null);
      return;
    }

    const { error: metadataError } = await supabase
      .from("transaction_attachments")
      .delete()
      .eq("company_id", companyId)
      .eq("id", attachment.id);

    if (metadataError) {
      setError(metadataError.message);
      setRemovingAttachmentId(null);
      return;
    }

    setRemovingAttachmentId(null);
    await load();
    await onChanged();
  }

  if (!open || !transaction) return null;

  return (
    <div className="transaction-organizer-backdrop" role="presentation">
      <section
        className="transaction-organizer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-organizer-title"
      >
        <header className="transaction-organizer-header">
          <div>
            <span>ORGANIZAÇÃO DO LANÇAMENTO</span>
            <h2 id="transaction-organizer-title">{transaction.description}</h2>
            <p>Use tags para classificar e anexe comprovantes ou documentos relacionados.</p>
          </div>
          <button
            type="button"
            className="transaction-organizer-close"
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <div className="transaction-organizer-body">
          {schemaReady === false && (
            <div className="reconciliation-schema-warning">
              <strong>Ativação necessária no banco de dados</strong>
              <span>
                Aplique a migration <code>20261029_015_transaction_tags_attachments.sql</code> no
                Supabase.
              </span>
            </div>
          )}

          {error && <div className="form-alert error">{error}</div>}

          {loading ? (
            <div className="empty-inline">Carregando organização...</div>
          ) : (
            <>
              <section className="transaction-organizer-section">
                <div className="transaction-organizer-title-row">
                  <div>
                    <h3>Tags</h3>
                    <p>Classificações reutilizáveis para localizar e agrupar lançamentos.</p>
                  </div>
                  <span>{selectedTags.length} selecionada(s)</span>
                </div>

                {canManage && schemaReady === true && (
                  <div className="transaction-tag-create">
                    <input
                      value={newTag}
                      onChange={(event) => setNewTag(event.target.value)}
                      placeholder="Nova tag"
                      maxLength={40}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void createTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void createTag()}
                      disabled={savingTag || !newTag.trim()}
                    >
                      {savingTag ? "Criando..." : "Criar tag"}
                    </button>
                  </div>
                )}

                <div className="transaction-tag-list">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.has(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        className={selected ? "transaction-tag selected" : "transaction-tag"}
                        onClick={() => void toggleTag(tag.id)}
                        disabled={!canManage || schemaReady !== true}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                  {tags.length === 0 && (
                    <div className="empty-inline">Nenhuma tag criada para esta empresa.</div>
                  )}
                </div>
              </section>

              <section className="transaction-organizer-section">
                <div className="transaction-organizer-title-row">
                  <div>
                    <h3>Anexos</h3>
                    <p>PDF, imagens, Word, Excel, CSV ou TXT. Limite de 10 MB por arquivo.</p>
                  </div>
                  <span>{attachments.length} arquivo(s)</span>
                </div>

                {canManage && schemaReady === true && (
                  <div className="transaction-attachment-upload">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx"
                      onChange={uploadFiles}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? "Enviando..." : "Adicionar arquivo"}
                    </button>
                    <small>Os anexos são privados e vinculados à empresa.</small>
                  </div>
                )}

                <div className="transaction-attachment-list">
                  {attachments.map((attachment) => (
                    <div className="transaction-attachment-row" key={attachment.id}>
                      <div>
                        <strong>{attachment.file_name}</strong>
                        <span>
                          {formatBytes(attachment.file_size)} ·{" "}
                          {new Date(attachment.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      <div>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => void downloadAttachment(attachment)}
                        >
                          Baixar
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            className="table-action danger"
                            onClick={() => void removeAttachment(attachment)}
                            disabled={removingAttachmentId === attachment.id}
                          >
                            {removingAttachmentId === attachment.id ? "Removendo..." : "Remover"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {attachments.length === 0 && (
                    <div className="empty-inline">Nenhum arquivo anexado a este lançamento.</div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="transaction-organizer-actions">
          <button type="button" className="primary" onClick={onClose}>
            Concluir
          </button>
        </footer>
      </section>
    </div>
  );
}
