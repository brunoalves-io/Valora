
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  AIOperationCard,
  type AIOperationAction,
  type AIActionStatus,
} from "./AIOperationCard";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AIRequestMessage = {
  role: "user" | "assistant";
  content: string;
};

type RetryRequest = {
  conversationId: string;
  messages: AIRequestMessage[];
};

type AIActionLog = {
  id: string;
  conversation_id: string | null;
  action_type: "create_transaction" | "create_recurrence";
  status: AIActionStatus;
  summary: string;
  payload: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  error_message: string | null;
  created_at: string;
  confirmed_at: string | null;
};

type NamedItem = {
  id: string;
  name: string;
};

const suggestions = [
  "Quanto gastei com alimentação nos últimos 90 dias?",
  "Paguei R$ 189,90 de internet hoje pelo Nubank",
  "Crie uma conta a pagar de R$ 780 para sexta-feira",
  "Cadastre uma despesa mensal de R$ 99 com software",
];

function conversationTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 54 ? clean.slice(0, 54).trim() + "…" : clean;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function actionStatusLabel(status: AIActionStatus) {
  if (status === "confirmed") return "Confirmada";
  if (status === "cancelled") return "Cancelada";
  if (status === "failed") return "Falhou";
  return "Proposta";
}

function friendlyAIError(message: string, code?: string) {
  const normalized = message.toLocaleLowerCase("pt-BR");

  if (
    code === "AI_TEMPORARILY_UNAVAILABLE" ||
    normalized.includes("503") ||
    normalized.includes("high demand") ||
    normalized.includes("overloaded") ||
    normalized.includes("temporarily unavailable")
  ) {
    return "A Valora IA está temporariamente sobrecarregada. Aguarde alguns instantes e tente novamente.";
  }

  if (code === "AI_RATE_LIMIT" || normalized.includes("429")) {
    return "A Valora IA atingiu temporariamente o limite de solicitações. Aguarde alguns instantes e tente novamente.";
  }

  if (code === "AI_PROVIDER_UNREACHABLE") {
    return "Não foi possível conectar ao serviço de IA. Verifique sua conexão e tente novamente.";
  }

  return message;
}

export function ValoraAIPage() {
  const { activeCompany, activeRole } = useCompany();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [pendingConversationDelete, setPendingConversationDelete] = useState<Conversation | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [historyView, setHistoryView] = useState<"conversations" | "actions">("conversations");
  const [actionLogs, setActionLogs] = useState<AIActionLog[]>([]);
  const [actionBusyId, setActionBusyId] = useState("");
  const [accounts, setAccounts] = useState<NamedItem[]>([]);
  const [categories, setCategories] = useState<NamedItem[]>([]);
  const [costCenters, setCostCenters] = useState<NamedItem[]>([]);
  const [partners, setPartners] = useState<NamedItem[]>([]);
  const [tags, setTags] = useState<NamedItem[]>([]);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const canManage = activeRole === "owner" || activeRole === "admin";

  async function loadConversations(selectFirst = false) {
    if (!supabase || !activeCompany) return;

    setLoadingConversations(true);

    const { data, error: queryError } = await supabase
      .from("ai_conversations")
      .select("id, title, created_at, updated_at")
      .eq("company_id", activeCompany.id)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (queryError) {
      setError(queryError.message);
      setLoadingConversations(false);
      return;
    }

    const items = (data ?? []) as Conversation[];
    setConversations(items);
    setLoadingConversations(false);

    if (selectFirst && items[0]) {
      setActiveConversationId(items[0].id);
    }
  }

  async function loadActionHistory() {
    if (!supabase || !activeCompany) return;

    const { data, error: historyError } = await supabase
      .from("ai_action_logs")
      .select(
        "id, conversation_id, action_type, status, summary, payload, entity_type, entity_id, error_message, created_at, confirmed_at",
      )
      .eq("company_id", activeCompany.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!historyError) {
      setActionLogs((data ?? []) as AIActionLog[]);
    }
  }

  async function loadActionNames() {
    if (!supabase || !activeCompany) return;

    const companyId = activeCompany.id;
    const [accountResult, categoryResult, centerResult, partnerResult, tagResult] =
      await Promise.all([
        supabase
          .from("financial_accounts")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("categories")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("cost_centers")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("business_partners")
          .select("id, name")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("transaction_tags")
          .select("id, name")
          .eq("company_id", companyId)
          .order("name"),
      ]);

    if (!accountResult.error) setAccounts((accountResult.data ?? []) as NamedItem[]);
    if (!categoryResult.error) setCategories((categoryResult.data ?? []) as NamedItem[]);
    if (!centerResult.error) setCostCenters((centerResult.data ?? []) as NamedItem[]);
    if (!partnerResult.error) setPartners((partnerResult.data ?? []) as NamedItem[]);
    if (!tagResult.error) setTags((tagResult.data ?? []) as NamedItem[]);
  }

  async function loadMessages(conversationId: string) {
    if (!supabase) return;

    setLoadingMessages(true);
    setError("");

    const { data, error: queryError } = await supabase
      .from("ai_messages")
      .select("id, role, content, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (queryError) {
      setError(queryError.message);
    } else {
      setMessages((data ?? []) as Message[]);
    }

    setLoadingMessages(false);
  }

  useEffect(() => {
    setActiveConversationId(null);
    setMessages([]);
    setQuestion("");
    setRetryRequest(null);
    setHistoryView("conversations");
    setActionLogs([]);
    setError("");
    void loadConversations(false);
    void loadActionHistory();
    void loadActionNames();
  }, [activeCompany?.id]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const hasMessages = messages.length > 0;

  const conversationMap = useMemo(
    () => new Map(conversations.map((item) => [item.id, item])),
    [conversations],
  );

  const actionLogMap = useMemo(
    () => new Map(actionLogs.map((item) => [item.id, item])),
    [actionLogs],
  );

  const actionNames = useMemo(
    () => ({
      accounts: new Map(accounts.map((item) => [item.id, item.name])),
      categories: new Map(categories.map((item) => [item.id, item.name])),
      costCenters: new Map(costCenters.map((item) => [item.id, item.name])),
      partners: new Map(partners.map((item) => [item.id, item.name])),
      tags: new Map(tags.map((item) => [item.id, item.name])),
    }),
    [accounts, categories, costCenters, partners, tags],
  );

  function startNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setQuestion("");
    setRetryRequest(null);
    setError("");
  }

  function requestRemoveConversation(conversation: Conversation) {
    if (deletingConversationId) return;
    setPendingConversationDelete(conversation);
  }

  async function confirmRemoveConversation() {
    if (!supabase || !pendingConversationDelete || deletingConversationId) return;
    const conversation = pendingConversationDelete;
    setDeletingConversationId(conversation.id);

    const { error: deleteError } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", conversation.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingConversationId(null);
      setPendingConversationDelete(null);
      return;
    }

    if (activeConversationId === conversation.id) {
      startNewConversation();
    }

    setDeletingConversationId(null);
    setPendingConversationDelete(null);
    await loadConversations(false);
  }

  async function requestAIAnswer(
    conversationId: string,
    historyForAI: AIRequestMessage[],
  ) {
    if (!supabase) return false;

    const { data: aiData, error: invokeError } = await supabase.functions.invoke(
      "valora-ai",
      {
        body: {
          companyId: activeCompany?.id,
          conversationId,
          today: localToday(),
          messages: historyForAI,
        },
      },
    );

    if (invokeError || !aiData?.answer) {
      let message =
        invokeError?.message ||
        aiData?.error ||
        "A Valora IA não conseguiu responder agora.";
      let code = aiData?.code as string | undefined;

      const response = (invokeError as { context?: Response } | null)?.context;
      if (response) {
        try {
          const body = await response.clone().json();
          if (body?.error) message = body.error;
          if (body?.code) code = body.code;
        } catch {
          // Keep the original Functions error when the body is not JSON.
        }
      }

      setError(friendlyAIError(String(message), code));
      setRetryRequest({ conversationId, messages: historyForAI });
      return false;
    }

    const { data: savedAssistant, error: assistantSaveError } = await supabase
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        company_id: activeCompany?.id,
        role: "assistant",
        content: String(aiData.answer),
        metadata: {
          model: aiData.model ?? null,
          fallback_used: aiData.fallbackUsed ?? false,
          generated_at: aiData.generatedAt ?? null,
          intent: aiData.intent ?? "query",
          action: aiData.action ?? null,
          ai_action_id: aiData.actionId ?? null,
          action_error: aiData.actionError ?? null,
        },
      })
      .select("id, role, content, metadata, created_at")
      .single();

    if (assistantSaveError || !savedAssistant) {
      setError(
        assistantSaveError?.message ||
          "A resposta foi gerada, mas não pôde ser salva no histórico.",
      );
      setRetryRequest(null);
      return false;
    }

    setMessages((current) => [...current, savedAssistant as Message]);
    if (aiData.actionId) {
      await loadActionHistory();
    }
    setRetryRequest(null);
    setError("");
    return true;
  }

  async function retryLastRequest() {
    if (!retryRequest || sending) return;

    setSending(true);
    setError("");

    await requestAIAnswer(retryRequest.conversationId, retryRequest.messages);

    setSending(false);
    await loadConversations(false);
  }

  async function ask(text: string) {
    if (!supabase || !activeCompany || sending) return;

    const clean = text.trim();
    if (!clean) return;

    if (clean.length > 5000) {
      setError("A pergunta é muito longa. Resuma para até 5.000 caracteres.");
      return;
    }

    setSending(true);
    setRetryRequest(null);
    setError("");
    setQuestion("");

    let conversationId = activeConversationId;
    let createdConversation = false;

    if (!conversationId) {
      const { data: conversation, error: createError } = await supabase
        .from("ai_conversations")
        .insert({
          company_id: activeCompany.id,
          title: conversationTitle(clean),
        })
        .select("id, title, created_at, updated_at")
        .single();

      if (createError || !conversation) {
        setError(createError?.message || "Não foi possível criar a conversa.");
        setSending(false);
        return;
      }

      conversationId = conversation.id;
      createdConversation = true;
      setActiveConversationId(conversation.id);
      setConversations((current) => [conversation as Conversation, ...current]);
    }

    if (!conversationId) {
      setError("Não foi possível preparar a conversa para a Valora IA.");
      setSending(false);
      return;
    }

    const optimisticUser: Message = {
      id: "temp-user-" + Date.now(),
      role: "user",
      content: clean,
      metadata: {},
      created_at: new Date().toISOString(),
    };

    const historyForAI = [
      ...messages.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: "user" as const, content: clean },
    ].slice(-12);

    setMessages((current) => [...current, optimisticUser]);

    const { data: savedUser, error: userSaveError } = await supabase
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        company_id: activeCompany.id,
        role: "user",
        content: clean,
      })
      .select("id, role, content, metadata, created_at")
      .single();

    if (userSaveError || !savedUser) {
      setMessages((current) =>
        current.filter((item) => item.id !== optimisticUser.id),
      );
      setError(userSaveError?.message || "Não foi possível salvar sua pergunta.");
      setSending(false);
      return;
    }

    setMessages((current) =>
      current.map((item) =>
        item.id === optimisticUser.id ? (savedUser as Message) : item,
      ),
    );

    await requestAIAnswer(conversationId, historyForAI);

    setSending(false);
    await loadConversations(false);

    if (createdConversation) {
      setActiveConversationId(conversationId);
    }
  }

  async function confirmAIAction(actionId: string) {
    if (!supabase || !actionId || actionBusyId) return;

    setActionBusyId(actionId);
    setError("");

    const { data, error: actionError } = await supabase.rpc(
      "execute_ai_action",
      { p_action_id: actionId },
    );

    const result = data as
      | { success?: boolean; error?: string; entity_type?: string; entity_id?: string }
      | null;

    if (actionError || result?.success === false) {
      setError(
        result?.error ||
          actionError?.message ||
          "Não foi possível confirmar esta ação da Valora IA.",
      );
    }

    await loadActionHistory();
    await loadActionNames();
    setActionBusyId("");
  }

  async function cancelAIAction(actionId: string) {
    if (!supabase || !actionId || actionBusyId) return;

    setActionBusyId(actionId);
    setError("");

    const { error: cancelError } = await supabase.rpc("cancel_ai_action", {
      p_action_id: actionId,
    });

    if (cancelError) {
      setError(cancelError.message);
    }

    await loadActionHistory();
    setActionBusyId("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <>
      <header className="page-header split ai-page-header">
        <div>
          <p className="eyebrow">INTELIGÊNCIA FINANCEIRA</p>
          <h1>Valora IA</h1>
          <p>
            Converse com os dados financeiros da {activeCompany?.name ?? "empresa"}.
          </p>
        </div>
      </header>

      <section className="ai-workspace">
        <aside className="panel ai-history">
          <button className="primary ai-new-chat" onClick={startNewConversation}>
            + Nova conversa
          </button>

          <div className="ai-history-heading">
            <strong>Histórico</strong>
            <span>Suas conversas nesta empresa</span>
          </div>

          <div className="ai-conversation-list">
            {loadingConversations ? (
              <div className="ai-history-empty">Carregando...</div>
            ) : conversations.length === 0 ? (
              <div className="ai-history-empty">
                Suas conversas aparecerão aqui.
              </div>
            ) : (
              conversations.map((conversation) => (
                <div
                  className={
                    activeConversationId === conversation.id
                      ? "ai-conversation-item active"
                      : "ai-conversation-item"
                  }
                  key={conversation.id}
                >
                  <button
                    className="ai-conversation-open"
                    onClick={() => setActiveConversationId(conversation.id)}
                    title={conversation.title}
                  >
                    <strong>{conversation.title}</strong>
                    <span>
                      {new Date(conversation.updated_at).toLocaleDateString("pt-BR")}
                    </span>
                  </button>
                  <button
                    className="ai-conversation-delete"
                    onClick={() => requestRemoveConversation(conversation)}
                    title="Excluir conversa"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="panel ai-chat">
          <div className="ai-chat-topbar">
            <div>
              <strong>
                {activeConversationId
                  ? conversationMap.get(activeConversationId)?.title ?? "Conversa"
                  : "Nova análise"}
              </strong>
              <span>Baseado nos dados atuais do Valora</span>
            </div>
            <span className="ai-online-dot">Dados da empresa</span>
          </div>

          <div className="ai-messages">
            {loadingMessages ? (
              <div className="ai-chat-empty">Abrindo conversa...</div>
            ) : !hasMessages ? (
              <div className="ai-welcome">
                <div className="ai-welcome-mark">✦</div>
                <h2>O que você quer entender sobre sua empresa?</h2>
                <p>
                  Posso analisar caixa, vencimentos, despesas, recebimentos,
                  cartões, propostas e alertas usando os números registrados no Valora.
                </p>

                <div className="ai-suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void ask(suggestion)}
                      disabled={sending}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article className={"ai-message " + message.role} key={message.id}>
                  <div className="ai-message-author">
                    <strong>{message.role === "user" ? "Você" : "Valora IA"}</strong>
                    <time>{formatTime(message.created_at)}</time>
                  </div>
                  <div className="ai-message-content">{message.content}</div>
                </article>
              ))
            )}

            {sending && (
              <article className="ai-message assistant thinking">
                <div className="ai-message-author">
                  <strong>Valora IA</strong>
                </div>
                <div className="ai-thinking">
                  <i />
                  <i />
                  <i />
                  Analisando os dados financeiros...
                </div>
              </article>
            )}

            <div ref={endRef} />
          </div>

          {error && (
            <div className="form-alert error ai-error">
              <span>{error}</span>
              {retryRequest && (
                <button
                  type="button"
                  className="ai-retry-button"
                  onClick={() => void retryLastRequest()}
                  disabled={sending}
                >
                  {sending ? "Tentando..." : "Tentar novamente"}
                </button>
              )}
            </div>
          )}

          <form className="ai-composer" onSubmit={submit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder='Ex.: "Quanto tenho para pagar nos próximos 7 dias?"'
              maxLength={5000}
              rows={2}
              disabled={sending}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  if (question.trim()) void ask(question);
                }
              }}
            />
            <button className="primary" disabled={sending || !question.trim()}>
              {sending ? "Pensando..." : "Enviar"}
            </button>
          </form>

          <p className="ai-disclaimer">
            O Valora IA interpreta os dados registrados no sistema e pode cometer
            erros. Não substitui orientação contábil, fiscal ou jurídica.
          </p>
        </section>
      </section>
      <ConfirmDialog
        open={Boolean(pendingConversationDelete)}
        title="Excluir conversa?"
        description={pendingConversationDelete ? `Você está prestes a excluir “${pendingConversationDelete.title}”.` : ""}
        warning="Essa ação é permanente e removerá o histórico desta conversa."
        confirmLabel="Excluir conversa"
        busy={Boolean(deletingConversationId)}
        onCancel={() => { if (!deletingConversationId) setPendingConversationDelete(null); }}
        onConfirm={() => void confirmRemoveConversation()}
      />
    </>
  );
}
