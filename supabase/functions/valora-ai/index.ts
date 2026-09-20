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
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const geminiModel = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";

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

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents,
          generationConfig: {
            temperature: 0.2,
            topP: 0.85,
            maxOutputTokens: 1400,
          },
        }),
      },
    );
  } catch {
    return jsonResponse({
      error: "Não foi possível conectar ao provedor de IA.",
      code: "AI_PROVIDER_UNREACHABLE",
    }, 502);
  }

  const geminiData = await geminiResponse.json().catch(() => ({}));

  if (!geminiResponse.ok) {
    const providerMessage =
      geminiData?.error?.message ||
      "O provedor de IA recusou a solicitação.";

    return jsonResponse({
      error:
        geminiResponse.status === 429
          ? "O limite temporário da IA foi atingido. Tente novamente em alguns instantes."
          : "A IA não conseguiu responder agora.",
      code: geminiResponse.status === 429 ? "AI_RATE_LIMIT" : "AI_PROVIDER_ERROR",
      detail: String(providerMessage).slice(0, 800),
    }, geminiResponse.status === 429 ? 429 : 502);
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
    model: geminiModel,
    generatedAt: new Date().toISOString(),
  });
});
