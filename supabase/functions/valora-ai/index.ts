const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AIContextItem = {
  id?: string;
  name?: string;
  type?: string;
  kind?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function sanitizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" as const : "user" as const,
      content: typeof item.content === "string"
        ? item.content.trim().slice(0, 5000)
        : "",
    }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function sanitizeDraftText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function sanitizeToday(value: unknown) {
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function extractJsonObject(value: string) {
  const clean = value
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Invalid JSON");
  }
}

function contextList(context: Record<string, unknown>, key: string): AIContextItem[] {
  const value = context[key];
  return Array.isArray(value)
    ? value.filter((item): item is AIContextItem =>
      Boolean(item && typeof item === "object"),
    )
    : [];
}

function validContextId(
  context: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (typeof value !== "string" || !value) return null;
  const exists = contextList(context, key).some((item) => item.id === value);
  return exists ? value : null;
}

function normalizedDraft(
  raw: Record<string, unknown>,
  context: Record<string, unknown>,
  today: string,
) {
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const type =
    raw.type === "income" || raw.type === "expense" ? raw.type : null;

  const numericAmount =
    typeof raw.amount === "number"
      ? raw.amount
      : typeof raw.amount === "string"
        ? Number(raw.amount.replace(",", "."))
        : NaN;
  const amount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : null;

  const description =
    typeof raw.description === "string"
      ? raw.description.trim().slice(0, 180)
      : "";

  const dueDate =
    typeof raw.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date)
      ? raw.due_date
      : today;

  const status =
    raw.status === "paid" || raw.status === "pending" ? raw.status : "pending";

  let categoryId = validContextId(context, "categories", raw.category_id);
  if (categoryId && type) {
    const category = contextList(context, "categories").find(
      (item) => item.id === categoryId,
    );
    if (category?.type !== type && category?.type !== "both") {
      categoryId = null;
      warnings.push("A categoria sugerida não era compatível com o tipo do lançamento.");
    }
  }

  let partnerId = validContextId(context, "partners", raw.partner_id);
  if (partnerId && type) {
    const partner = contextList(context, "partners").find(
      (item) => item.id === partnerId,
    );
    const compatible =
      partner?.kind === "both" ||
      (type === "income" && partner?.kind === "customer") ||
      (type === "expense" && partner?.kind === "supplier");

    if (!compatible) {
      partnerId = null;
      warnings.push("O cliente/fornecedor sugerido não era compatível com o tipo do lançamento.");
    }
  }

  const validTagIds = new Set(
    contextList(context, "tags")
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id)),
  );

  const tagIds = Array.isArray(raw.tag_ids)
    ? Array.from(
        new Set(
          raw.tag_ids.filter(
            (item): item is string =>
              typeof item === "string" && validTagIds.has(item),
          ),
        ),
      ).slice(0, 8)
    : [];

  const confidence =
    raw.confidence === "high" ||
      raw.confidence === "medium" ||
      raw.confidence === "low"
      ? raw.confidence
      : "medium";

  const summary =
    typeof raw.summary === "string" ? raw.summary.trim().slice(0, 280) : "";

  if (!type) warnings.push("Revise se o lançamento é uma receita ou despesa.");
  if (!amount) warnings.push("Informe o valor antes de criar o lançamento.");
  if (!description) warnings.push("Informe uma descrição antes de criar o lançamento.");

  return {
    type,
    description,
    amount,
    due_date: dueDate,
    status,
    account_id: validContextId(context, "accounts", raw.account_id),
    category_id: categoryId,
    cost_center_id: validContextId(context, "cost_centers", raw.cost_center_id),
    partner_id: partnerId,
    tag_ids: tagIds,
    confidence,
    summary,
    warnings: Array.from(new Set(warnings)).slice(0, 5),
  };
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  const geminiModel = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-3.5-flash-lite";
  const geminiFallbackModel =
    Deno.env.get("GEMINI_FALLBACK_MODEL")?.trim() || "gemini-2.5-flash-lite";

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Supabase function environment is incomplete" }, 500);
  }

  if (!geminiApiKey) {
    return jsonResponse({
      error: "Valora IA ainda não foi configurada. Defina o secret GEMINI_API_KEY na Edge Function.",
      code: "AI_NOT_CONFIGURED",
    }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const companyId =
    typeof payload.companyId === "string" ? payload.companyId.trim() : "";
  const mode =
    payload.mode === "transaction_draft" ? "transaction_draft" : "chat";

  if (!companyId) {
    return jsonResponse({ error: "companyId is required" }, 400);
  }

  const messages = sanitizeMessages(payload.messages);
  const draftText = sanitizeDraftText(payload.text);
  const today = sanitizeToday(payload.today) || new Date().toISOString().slice(0, 10);

  if (
    mode === "chat" &&
    (messages.length === 0 || messages[messages.length - 1].role !== "user")
  ) {
    return jsonResponse({ error: "A user message is required" }, 400);
  }

  if (mode === "transaction_draft" && !draftText) {
    return jsonResponse({ error: "text is required" }, 400);
  }

  const contextRpc =
    mode === "transaction_draft"
      ? "get_ai_transaction_context"
      : "get_ai_financial_context";

  const contextResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/${contextRpc}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: authorization,
      },
      body: JSON.stringify({
        p_company_id: companyId,
      }),
    },
  );

  if (!contextResponse.ok) {
    const detail = await contextResponse.text();
    const status = contextResponse.status === 401 || contextResponse.status === 403
      ? 403
      : 500;

    return jsonResponse({
      error: status === 403
        ? "Você não tem permissão para usar este recurso nesta empresa."
        : "Não foi possível preparar o contexto financeiro.",
      detail: detail.slice(0, 800),
    }, status);
  }

  const financialContext = await contextResponse.json() as Record<string, unknown>;

  const systemInstruction =
    mode === "transaction_draft"
      ? [
          "Você é o Valora IA em modo de preparação de lançamento financeiro.",
          "Interprete o texto do usuário em português do Brasil e devolva SOMENTE um objeto JSON válido, sem markdown.",
          "Você nunca cria o lançamento. Apenas prepara um rascunho para revisão humana.",
          `A data local informada pelo aplicativo é ${today}.`,
          "Use somente IDs que existam no CONTEXTO DA EMPRESA. Quando não houver correspondência segura, use null ou [] em vez de inventar.",
          "Use o histórico recente apenas para reconhecer padrões reais da empresa, como categoria, conta, fornecedor/cliente, centro de custo e tags usados em descrições parecidas.",
          "Para frases no passado concluído como 'paguei', 'comprei', 'recebi' ou 'vendi', normalmente use status 'paid'. Para obrigações futuras ou ainda não quitadas, use 'pending'.",
          "Se a data não for citada e a ação já ocorreu, use a data local de hoje.",
          "A descrição deve ser curta, profissional e sem repetir valor ou data.",
          "Uma categoria deve aceitar o tipo do lançamento: income, expense ou both.",
          "Para income, parceiro deve ser customer ou both. Para expense, parceiro deve ser supplier ou both.",
          "Não invente parcelamentos, recorrências nem registros que não estejam no pedido.",
          "Campos obrigatórios para o usuário revisar: type, description, amount, due_date e status.",
          "Formato JSON obrigatório:",
          JSON.stringify({
            type: "expense | income | null",
            description: "string",
            amount: "number | null",
            due_date: "YYYY-MM-DD",
            status: "paid | pending",
            account_id: "uuid | null",
            category_id: "uuid | null",
            cost_center_id: "uuid | null",
            partner_id: "uuid | null",
            tag_ids: ["uuid"],
            confidence: "high | medium | low",
            summary: "frase curta explicando o rascunho",
            warnings: ["aviso curto se houver ambiguidade"],
          }),
          "",
          "CONTEXTO DA EMPRESA:",
          JSON.stringify(financialContext),
        ].join("\n")
      : [
          "Você é o Valora IA, assistente de gestão financeira empresarial do aplicativo Valora.",
          "Responda sempre em português do Brasil, de forma clara, objetiva e útil para um gestor.",
          "Use SOMENTE o contexto financeiro fornecido abaixo para afirmar números específicos da empresa.",
          "Nunca invente valores, datas, clientes, despesas, saldos ou tendências.",
          "Diferencie explicitamente valores realizados, pendentes, vencidos e projetados quando isso for relevante.",
          "Se a pergunta exigir dados que não estão no contexto, diga que o Valora ainda não possui dados suficientes para concluir.",
          "Você está em modo somente consulta. Pode sugerir próximos passos, mas nunca diga que criou, pagou, alterou ou excluiu registros.",
          "Não apresente a resposta como contabilidade oficial, parecer jurídico, fiscal ou tributário.",
          "Formate valores em reais (R$) e datas no padrão brasileiro quando possível.",
          "Prefira respostas curtas, com diagnóstico e próximos passos. Use listas apenas quando ajudarem.",
          "",
          "CONTEXTO FINANCEIRO ATUAL DA EMPRESA:",
          JSON.stringify(financialContext),
        ].join("\n");

  const contents =
    mode === "transaction_draft"
      ? [{ role: "user", parts: [{ text: draftText }] }]
      : messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        }));

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: mode === "transaction_draft" ? 1000 : 1400,
  };

  if (mode === "transaction_draft") {
    generationConfig.responseMimeType = "application/json";
  }

  const requestBody = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents,
    generationConfig,
  });

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const transientStatuses = new Set([429, 500, 502, 503, 504]);
  const models = Array.from(
    new Set([geminiModel, geminiFallbackModel].filter(Boolean)),
  );

  let finalResponse: Response | null = null;
  let finalData: Record<string, any> = {};
  let usedModel = geminiModel;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const maxAttempts = modelIndex === 0 ? 3 : 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiApiKey,
            },
            body: requestBody,
          },
        );
      } catch {
        if (attempt < maxAttempts) {
          await sleep(450 * attempt);
          continue;
        }

        if (modelIndex < models.length - 1) break;

        return jsonResponse({
          error:
            "A Valora IA não conseguiu se conectar ao serviço de IA. Tente novamente em alguns instantes.",
          code: "AI_PROVIDER_UNREACHABLE",
        }, 502);
      }

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        finalResponse = response;
        finalData = data;
        usedModel = model;
        break;
      }

      finalResponse = response;
      finalData = data;
      usedModel = model;

      const canRetry = transientStatuses.has(response.status);
      if (canRetry && attempt < maxAttempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 2500)
          : 500 * attempt;
        await sleep(delay);
        continue;
      }

      const canUseFallback =
        modelIndex < models.length - 1 &&
        (canRetry || response.status === 404);

      if (canUseFallback) break;
      break;
    }

    if (finalResponse?.ok) break;
  }

  const geminiResponse = finalResponse;
  const geminiData = finalData;

  if (!geminiResponse) {
    return jsonResponse({
      error:
        "A Valora IA está temporariamente indisponível. Aguarde alguns instantes e tente novamente.",
      code: "AI_TEMPORARILY_UNAVAILABLE",
    }, 503);
  }

  if (!geminiResponse.ok) {
    const providerMessage =
      geminiData?.error?.message ||
      geminiData?.message ||
      "O provedor de IA recusou a solicitação.";

    const providerDetail = String(providerMessage).slice(0, 900);

    console.error("Valora AI provider error", {
      status: geminiResponse.status,
      model: usedModel,
      message: providerDetail,
      mode,
    });

    let publicMessage =
      "A Valora IA não conseguiu responder agora. Tente novamente em alguns instantes.";
    let code = "AI_PROVIDER_ERROR";
    let responseStatus = 502;

    if (geminiResponse.status === 400) {
      publicMessage =
        "A solicitação não pôde ser processada pela IA. Tente reformular o texto.";
      code = "AI_BAD_REQUEST";
    } else if (geminiResponse.status === 401 || geminiResponse.status === 403) {
      publicMessage =
        "A integração da Valora IA precisa ser revisada pelo administrador.";
      code = "AI_AUTH_ERROR";
    } else if (geminiResponse.status === 404) {
      publicMessage =
        "O modelo de IA configurado está indisponível no momento.";
      code = "AI_MODEL_ERROR";
    } else if (geminiResponse.status === 429) {
      publicMessage =
        "A Valora IA atingiu temporariamente o limite de solicitações. Aguarde alguns instantes e tente novamente.";
      code = "AI_RATE_LIMIT";
      responseStatus = 429;
    } else if ([500, 502, 503, 504].includes(geminiResponse.status)) {
      publicMessage =
        "A Valora IA está temporariamente sobrecarregada. Aguarde alguns instantes e tente novamente.";
      code = "AI_TEMPORARILY_UNAVAILABLE";
      responseStatus = 503;
    }

    return jsonResponse({
      error: publicMessage,
      code,
      detail: providerDetail,
      providerStatus: geminiResponse.status,
      model: usedModel,
    }, responseStatus);
  }

  const answer = Array.isArray(geminiData?.candidates)
    ? geminiData.candidates
        .flatMap((candidate: Record<string, any>) =>
          Array.isArray(candidate?.content?.parts)
            ? candidate.content.parts
            : [],
        )
        .map((part: Record<string, unknown>) =>
          typeof part.text === "string" ? part.text : "",
        )
        .join("")
        .trim()
    : "";

  if (!answer) {
    return jsonResponse({
      error: mode === "transaction_draft"
        ? "A IA não conseguiu montar um rascunho. Tente descrever o lançamento com mais detalhes."
        : "A IA não retornou texto para esta pergunta. Tente reformular.",
      code: "AI_EMPTY_RESPONSE",
    }, 502);
  }

  if (mode === "transaction_draft") {
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(answer);
    } catch {
      console.error("Valora AI invalid draft JSON", {
        model: usedModel,
        answer: answer.slice(0, 1200),
      });
      return jsonResponse({
        error: "A IA retornou um rascunho inválido. Tente novamente.",
        code: "AI_INVALID_DRAFT",
      }, 502);
    }

    return jsonResponse({
      draft: normalizedDraft(parsed, financialContext, today),
      model: usedModel,
      fallbackUsed: usedModel !== geminiModel,
      generatedAt: new Date().toISOString(),
    });
  }

  return jsonResponse({
    answer,
    model: usedModel,
    fallbackUsed: usedModel !== geminiModel,
    generatedAt: new Date().toISOString(),
  });
});
