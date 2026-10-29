const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLUGGY_API = "https://api.pluggy.ai";

let cachedApiKey = "";
let cachedApiKeyUntil = 0;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function cleanText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function maskAccountNumber(value: unknown) {
  const clean = cleanText(value, 100);
  if (!clean) return "";
  if (clean.length <= 4) return clean;
  return `•••• ${clean.slice(-4)}`;
}

function statusFromItem(item: Record<string, any>) {
  const status = String(item.status ?? item.executionStatus ?? "").toUpperCase();
  const hasError = Boolean(item.error) || status.includes("ERROR");
  if (hasError) return "error";
  if (status.includes("UPDAT") || status.includes("LOGIN")) return "pending";
  return "active";
}

function itemError(item: Record<string, any>) {
  const value = item.error;
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value?.message === "string") return value.message.slice(0, 1000);
  if (typeof value?.code === "string") return value.code.slice(0, 1000);
  return JSON.stringify(value).slice(0, 1000);
}

function brazilDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function pluggyApiKey() {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET")?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("PLUGGY_NOT_CONFIGURED");
  }

  if (cachedApiKey && Date.now() < cachedApiKeyUntil) {
    return cachedApiKey;
  }

  const response = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data?.apiKey !== "string") {
    console.error("Pluggy auth failed", {
      status: response.status,
      message: data?.message ?? data?.codeDescription ?? "unknown",
    });
    throw new Error("PLUGGY_AUTH_FAILED");
  }

  cachedApiKey = data.apiKey;
  cachedApiKeyUntil = Date.now() + 100 * 60 * 1000;
  return cachedApiKey;
}

async function pluggyFetch(
  path: string,
  init: RequestInit = {},
) {
  const apiKey = await pluggyApiKey();
  const response = await fetch(`${PLUGGY_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Pluggy request failed", {
      path,
      status: response.status,
      code: data?.code ?? data?.codeDescription,
      message: data?.message,
    });
    throw new Error(
      cleanText(data?.message ?? data?.codeDescription ?? "PLUGGY_REQUEST_FAILED", 800) ||
        "PLUGGY_REQUEST_FAILED",
    );
  }

  return data;
}

function supabaseHeaders(authorization: string, extra: Record<string, string> = {}) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) throw new Error("SUPABASE_ENV_MISSING");

  return {
    apikey: anonKey,
    Authorization: authorization,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function dbFetch(
  path: string,
  authorization: string,
  init: RequestInit = {},
) {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_ENV_MISSING");

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(
      authorization,
      (init.headers ?? {}) as Record<string, string>,
    ),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    console.error("Database request failed", {
      path,
      status: response.status,
      code: data?.code,
      message: data?.message,
    });
    throw new Error(cleanText(data?.message ?? "DATABASE_REQUEST_FAILED", 800));
  }

  return data;
}

async function canManage(companyId: string, authorization: string) {
  const data = await dbFetch("rpc/can_manage_company", authorization, {
    method: "POST",
    body: JSON.stringify({ target_company: companyId }),
  });
  return data === true;
}

async function findConnection(
  companyId: string,
  itemId: string,
  authorization: string,
) {
  const rows = await dbFetch(
    `bank_connections?company_id=eq.${encodeURIComponent(companyId)}&provider=eq.pluggy&provider_item_id=eq.${encodeURIComponent(itemId)}&select=*`,
    authorization,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function saveConnection(
  companyId: string,
  item: Record<string, any>,
  authorization: string,
) {
  const connector = item.connector ?? {};
  const existing = await findConnection(companyId, String(item.id), authorization);
  const connectorId = connector.id == null ? null : String(connector.id);
  const connectionType =
    Number(connector.id) >= 600 ? "open_finance" : "aggregation";

  const payload = {
    company_id: companyId,
    provider: "pluggy",
    provider_item_id: String(item.id),
    connector_id: connectorId,
    institution_name: cleanText(connector.name, 180) || "Instituição financeira",
    institution_logo_url: cleanText(connector.imageUrl, 1000) || null,
    institution_primary_color: cleanText(connector.primaryColor, 40) || null,
    connection_type: connectionType,
    status: statusFromItem(item),
    last_error: itemError(item),
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const rows = await dbFetch(
      `bank_connections?id=eq.${encodeURIComponent(existing.id)}&select=*`,
      authorization,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      },
    );
    return rows?.[0] ?? { ...existing, ...payload };
  }

  const rows = await dbFetch("bank_connections?select=*", authorization, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  return rows?.[0];
}

async function saveExternalAccount(
  companyId: string,
  connectionId: string,
  account: Record<string, any>,
  authorization: string,
) {
  const current = await dbFetch(
    `bank_connection_accounts?connection_id=eq.${encodeURIComponent(connectionId)}&provider_account_id=eq.${encodeURIComponent(String(account.id))}&select=*`,
    authorization,
  );
  const existing = Array.isArray(current) ? current[0] ?? null : null;

  const providerType = String(account.type ?? "").toUpperCase();
  const accountType =
    providerType === "BANK" ? "bank" : providerType === "CREDIT" ? "credit" : "other";

  const payload = {
    company_id: companyId,
    connection_id: connectionId,
    provider_account_id: String(account.id),
    name:
      cleanText(account.marketingName, 180) ||
      cleanText(account.name, 180) ||
      "Conta financeira",
    account_type: accountType,
    subtype: cleanText(account.subtype, 100) || null,
    number_masked: maskAccountNumber(account.number) || null,
    currency_code: cleanText(account.currencyCode, 8) || "BRL",
    balance: Number.isFinite(Number(account.balance)) ? Number(account.balance) : null,
    available_balance: Number.isFinite(Number(account?.bankData?.availableBalance))
      ? Number(account.bankData.availableBalance)
      : null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const rows = await dbFetch(
      `bank_connection_accounts?id=eq.${encodeURIComponent(existing.id)}&select=*`,
      authorization,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      },
    );
    return rows?.[0] ?? { ...existing, ...payload };
  }

  const rows = await dbFetch("bank_connection_accounts?select=*", authorization, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  return rows?.[0];
}

async function fetchTransactions(providerAccountId: string, dateFrom: string) {
  const all: Record<string, any>[] = [];
  let next:
    | string
    | null = `?accountId=${encodeURIComponent(providerAccountId)}&dateFrom=${encodeURIComponent(dateFrom)}`;
  let pages = 0;

  while (next && pages < 12) {
    const data = await pluggyFetch(`/v2/transactions${next}`);
    if (Array.isArray(data?.results)) all.push(...data.results);
    next = typeof data?.next === "string" && data.next ? data.next : null;
    pages += 1;
  }

  return all;
}

async function saveTransactions(
  companyId: string,
  externalAccountId: string,
  transactions: Record<string, any>[],
  authorization: string,
) {
  if (!transactions.length) return 0;

  const normalized = transactions
    .filter((transaction) => transaction?.id && transaction?.date)
    .map((transaction) => {
      const type = String(transaction.type ?? "").toUpperCase() === "CREDIT"
        ? "CREDIT"
        : "DEBIT";
      const rawAmount = Number(transaction.amount);
      const safeRawAmount = Number.isFinite(rawAmount) ? rawAmount : 0;
      const statusValue = String(transaction.status ?? "").toUpperCase();
      const status =
        statusValue === "POSTED" || statusValue === "PENDING"
          ? statusValue
          : "UNKNOWN";

      return {
        company_id: companyId,
        external_account_id: externalAccountId,
        provider_transaction_id: String(transaction.id),
        provider_id: cleanText(transaction.providerId, 180) || null,
        provider_code: cleanText(transaction.providerCode, 180) || null,
        description: cleanText(transaction.description, 500) || "Movimentação bancária",
        description_raw: cleanText(transaction.descriptionRaw, 1000) || null,
        movement_type: type === "CREDIT" ? "income" : "expense",
        provider_type: type,
        status,
        amount: Math.abs(safeRawAmount),
        raw_amount: safeRawAmount,
        currency_code: cleanText(transaction.currencyCode, 8) || "BRL",
        transaction_at: new Date(transaction.date).toISOString(),
        transaction_date: brazilDate(String(transaction.date)),
        balance: Number.isFinite(Number(transaction.balance))
          ? Number(transaction.balance)
          : null,
        category: cleanText(transaction.category, 180) || null,
        operation_type:
          cleanText(transaction.operationType ?? transaction.operationTypeAdditionalInfo, 300) ||
          null,
        provider_updated_at:
          transaction.updatedAt && !Number.isNaN(new Date(transaction.updatedAt).getTime())
            ? new Date(transaction.updatedAt).toISOString()
            : null,
        updated_at: new Date().toISOString(),
      };
    });

  let saved = 0;
  for (let index = 0; index < normalized.length; index += 150) {
    const chunk = normalized.slice(index, index + 150);
    await dbFetch(
      "bank_connection_transactions?on_conflict=external_account_id,provider_transaction_id",
      authorization,
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(chunk),
      },
    );
    saved += chunk.length;
  }

  return saved;
}

async function syncItem(
  companyId: string,
  itemId: string,
  authorization: string,
) {
  const item = await pluggyFetch(`/items/${encodeURIComponent(itemId)}`);
  const connection = await saveConnection(companyId, item, authorization);
  if (!connection?.id) throw new Error("CONNECTION_SAVE_FAILED");

  const runRows = await dbFetch("bank_sync_runs?select=*", authorization, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      company_id: companyId,
      connection_id: connection.id,
      status: "running",
    }),
  });
  const run = runRows?.[0];

  try {
    const accountsResponse = await pluggyFetch(
      `/accounts?itemId=${encodeURIComponent(itemId)}`,
    );
    const accounts = Array.isArray(accountsResponse?.results)
      ? accountsResponse.results
      : [];

    const firstSync = !connection.last_successful_sync_at;
    const dateFrom = firstSync
      ? dateDaysAgo(90)
      : dateDaysAgo(21);

    let transactionCount = 0;

    for (const account of accounts) {
      const externalAccount = await saveExternalAccount(
        companyId,
        connection.id,
        account,
        authorization,
      );
      if (!externalAccount?.id || !account?.id) continue;

      const transactions = await fetchTransactions(String(account.id), dateFrom);
      transactionCount += await saveTransactions(
        companyId,
        externalAccount.id,
        transactions,
        authorization,
      );
    }

    const now = new Date().toISOString();

    await dbFetch(
      `bank_connections?id=eq.${encodeURIComponent(connection.id)}`,
      authorization,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: statusFromItem(item),
          last_sync_at: now,
          last_successful_sync_at: now,
          last_error: null,
          updated_at: now,
        }),
      },
    );

    if (run?.id) {
      await dbFetch(
        `bank_sync_runs?id=eq.${encodeURIComponent(run.id)}`,
        authorization,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "success",
            finished_at: now,
            accounts_synced: accounts.length,
            transactions_upserted: transactionCount,
          }),
        },
      );
    }

    return {
      connectionId: connection.id,
      itemId,
      accounts: accounts.length,
      transactions: transactionCount,
      dateFrom,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SYNC_FAILED";
    const now = new Date().toISOString();

    await dbFetch(
      `bank_connections?id=eq.${encodeURIComponent(connection.id)}`,
      authorization,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "error",
          last_sync_at: now,
          last_error: message.slice(0, 1000),
          updated_at: now,
        }),
      },
    ).catch(() => null);

    if (run?.id) {
      await dbFetch(
        `bank_sync_runs?id=eq.${encodeURIComponent(run.id)}`,
        authorization,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "error",
            finished_at: now,
            error_message: message.slice(0, 1000),
          }),
        },
      ).catch(() => null);
    }

    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = cleanText(payload.action, 60);
  const companyId = cleanText(payload.companyId, 80);
  const configured = Boolean(
    Deno.env.get("PLUGGY_CLIENT_ID")?.trim() &&
      Deno.env.get("PLUGGY_CLIENT_SECRET")?.trim(),
  );

  if (action === "config") {
    return jsonResponse({
      provider: "pluggy",
      configured,
      includeSandbox: Deno.env.get("PLUGGY_INCLUDE_SANDBOX") === "true",
      transactionWindowDays: 90,
    });
  }

  if (!companyId) {
    return jsonResponse({ error: "companyId is required" }, 400);
  }

  let allowed = false;
  try {
    allowed = await canManage(companyId, authorization);
  } catch {
    return jsonResponse({ error: "Não foi possível validar sua permissão." }, 500);
  }

  if (!allowed) {
    return jsonResponse(
      { error: "Você não tem permissão para gerenciar conexões bancárias nesta empresa." },
      403,
    );
  }

  if (!configured) {
    return jsonResponse(
      {
        error:
          "O provedor bancário ainda não foi configurado no backend. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nos secrets do Supabase.",
        code: "PROVIDER_NOT_CONFIGURED",
      },
      503,
    );
  }

  try {
    if (action === "connect-token") {
      const itemId = cleanText(payload.itemId, 180);
      const apiKey = await pluggyApiKey();
      const body = itemId
        ? { itemId }
        : {
            options: {
              clientUserId: `valora-company-${companyId}`,
              avoidDuplicates: true,
            },
          };

      const response = await fetch(`${PLUGGY_API}/connect_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data?.accessToken !== "string") {
        console.error("Pluggy connect token failed", {
          status: response.status,
          code: data?.code ?? data?.codeDescription,
        });
        return jsonResponse(
          { error: "Não foi possível iniciar a conexão bancária." },
          502,
        );
      }

      return jsonResponse({
        accessToken: data.accessToken,
        updateItem: itemId || null,
        includeSandbox: Deno.env.get("PLUGGY_INCLUDE_SANDBOX") === "true",
      });
    }

    if (action === "register-item") {
      const itemId = cleanText(payload.itemId, 180);
      if (!itemId) return jsonResponse({ error: "itemId is required" }, 400);

      const result = await syncItem(companyId, itemId, authorization);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === "sync") {
      const connectionId = cleanText(payload.connectionId, 80);
      if (!connectionId) {
        return jsonResponse({ error: "connectionId is required" }, 400);
      }

      const rows = await dbFetch(
        `bank_connections?id=eq.${encodeURIComponent(connectionId)}&company_id=eq.${encodeURIComponent(companyId)}&select=provider_item_id`,
        authorization,
      );
      const connection = Array.isArray(rows) ? rows[0] ?? null : null;
      if (!connection?.provider_item_id) {
        return jsonResponse({ error: "Conexão bancária não encontrada." }, 404);
      }

      const result = await syncItem(
        companyId,
        connection.provider_item_id,
        authorization,
      );
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "PLUGGY_NOT_CONFIGURED") {
      return jsonResponse(
        { error: "O provedor bancário ainda não foi configurado.", code: message },
        503,
      );
    }

    if (message === "PLUGGY_AUTH_FAILED") {
      return jsonResponse(
        {
          error:
            "As credenciais do provedor bancário foram recusadas. Revise a configuração do Pluggy.",
          code: message,
        },
        502,
      );
    }

    console.error("Open Finance function error", { action, message });
    return jsonResponse(
      {
        error: "Não foi possível concluir a operação bancária. Tente novamente.",
        code: "OPEN_FINANCE_ERROR",
        detail: message.slice(0, 500),
      },
      500,
    );
  }
});
