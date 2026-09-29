const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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
  const messages = sanitizeMessages(payload.messages);

  if (!companyId) {
    return jsonResponse({ error: "companyId is required" }, 400);
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return jsonResponse({ error: "A user message is required" }, 400);
  }

  const contextResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/get_ai_financial_context`,
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
        ? "Você não tem acesso aos dados desta empresa."
        : "Não foi possível preparar o contexto financeiro.",
      detail: detail.slice(0, 800),
    }, status);
  }

  const financialContext = await contextResponse.json();

  const systemInstruction = [
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

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const requestBody = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents,
    generationConfig: {
      maxOutputTokens: 1400,
    },
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
    });

    let publicMessage =
      "A Valora IA não conseguiu responder agora. Tente novamente em alguns instantes.";
    let code = "AI_PROVIDER_ERROR";
    let responseStatus = 502;

    if (geminiResponse.status === 400) {
      publicMessage =
        "A solicitação não pôde ser processada pela IA. Tente reformular a pergunta.";
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
      error: "A IA não retornou texto para esta pergunta. Tente reformular.",
      code: "AI_EMPTY_RESPONSE",
    }, 502);
  }

  return jsonResponse({
    answer,
    model: usedModel,
    fallbackUsed: usedModel !== geminiModel,
    generatedAt: new Date().toISOString(),
  });
});
