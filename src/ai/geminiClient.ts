import {
  loadAiSettings,
  type AiProvider,
} from "./keyStore.ts";
import { fitRequestToProviderBudget } from "./tokenOptimizer.ts";

export type ModelTier = "fast" | "synthesis";

export interface GeminiRequestOptions {
  tier: ModelTier;
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchema?: Record<string, unknown>;
  apiKey?: string;
  modelId?: string;
  provider?: AiProvider;
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface OpenAiApiResponse {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  error?: { message?: string; code?: string };
}

interface ProviderConfig {
  provider: AiProvider;
  model: string;
  endpoint: string;
  apiKey?: string;
}

function getProviderConfig(opts: GeminiRequestOptions): ProviderConfig {
  const settings = loadAiSettings();
  const provider = opts.provider ?? settings.provider;
  const model =
    opts.modelId ??
    (provider === "openai-compatible"
      ? settings.localModel
      : opts.tier === "fast"
        ? settings.fastModel
        : settings.synthesisModel);
  if (!model.trim()) {
    throw new Error(
      provider === "openai-compatible"
        ? "Set a local model name in Settings before making a request."
        : "Set a Gemini model in Settings before making a request."
    );
  }

  if (provider === "gemini") {
    const apiKey = opts.apiKey ?? settings.apiKey;
    if (!apiKey.trim()) {
      throw new Error(
        "Missing Gemini API key. Open Settings to paste your personal API key."
      );
    }
    return {
      provider,
      model,
      apiKey,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent`,
    };
  }

  const baseUrl = opts.baseUrl ?? settings.localBaseUrl;
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid local AI base URL: ${baseUrl}`);
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("Local AI base URL must use HTTP or HTTPS.");
  }
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = basePath.endsWith("/chat/completions")
    ? basePath
    : `${basePath}/chat/completions`;
  endpoint.search = "";
  endpoint.hash = "";
  return { provider, model, endpoint: endpoint.toString() };
}

function getTemperature(opts: GeminiRequestOptions): number {
  if (opts.temperature !== undefined) return opts.temperature;
  const settings = loadAiSettings();
  if ((opts.provider ?? settings.provider) === "openai-compatible") {
    return settings.localTemperature;
  }
  const preset = settings.creativityPreset;
  return preset === "focused" ? 0.2 : preset === "exploratory" ? 0.75 : 0.4;
}

function getErrorDetail(responseText: string, statusText: string): string {
  try {
    const body = JSON.parse(responseText) as {
      error?: { message?: string; status?: string };
    };
    if (body.error?.message) return body.error.message;
  } catch {
    // Keep the response body as a useful diagnostic when it is not JSON.
  }
  return responseText.trim() || statusText || "Unknown error";
}

function formatApiError(
  provider: AiProvider,
  model: string,
  status: number | string,
  statusText: string,
  responseText: string
): string {
  const name = provider === "gemini" ? "Gemini" : "Local AI";
  return `${name} API Error (${status}) [${model}]: ${getErrorDetail(
    responseText,
    statusText
  )}`;
}

class AiApiError extends Error {
  readonly provider: AiProvider;
  readonly model: string;
  readonly status: number | string;

  constructor(
    provider: AiProvider,
    model: string,
    status: number | string,
    statusText: string,
    responseText: string
  ) {
    super(formatApiError(provider, model, status, statusText, responseText));
    this.name = "AiApiError";
    this.provider = provider;
    this.model = model;
    this.status = status;
  }
}

const MAX_TRANSIENT_RETRIES = 2;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const LOCAL_CONTEXT_SAFETY_TOKENS = 128;
const LOCAL_MIN_INPUT_TOKENS = 384;

function getDefaultTimeoutMs(
  provider: AiProvider,
  tier: ModelTier
): number {
  if (provider === "openai-compatible") {
    return tier === "synthesis" ? 300_000 : 120_000;
  }
  return tier === "synthesis" ? 180_000 : 60_000;
}

function prepareRequestOptions(
  opts: GeminiRequestOptions,
  provider: AiProvider
): GeminiRequestOptions {
  if (provider !== "openai-compatible") {
    return {
      ...opts,
      ...fitRequestToProviderBudget(
        opts.systemInstruction,
        opts.userPrompt,
        provider,
        opts.jsonSchema
      ),
    };
  }

  const settings = loadAiSettings();
  const contextWindowTokens = settings.localContextWindowTokens;
  const configuredOutputLimit = Math.min(
    settings.localMaxOutputTokens,
    contextWindowTokens -
      LOCAL_CONTEXT_SAFETY_TOKENS -
      LOCAL_MIN_INPUT_TOKENS
  );
  const maxOutputTokens = Math.max(
    1,
    Math.min(
      opts.maxOutputTokens ?? settings.localMaxOutputTokens,
      configuredOutputLimit
    )
  );
  const inputBudget = Math.max(
    1,
    contextWindowTokens - LOCAL_CONTEXT_SAFETY_TOKENS - maxOutputTokens
  );
  return {
    ...opts,
    ...fitRequestToProviderBudget(
      opts.systemInstruction,
      opts.userPrompt,
      provider,
      opts.jsonSchema,
      inputBudget
    ),
    maxOutputTokens,
  };
}

async function withRequestTimeout<T>(
  opts: GeminiRequestOptions,
  config: ProviderConfig,
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutMs = Math.max(
    1,
    opts.timeoutMs ?? getDefaultTimeoutMs(config.provider, opts.tier)
  );
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (opts.signal?.aborted) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await request(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} request timed out after ${Math.ceil(
          timeoutMs / 1000
        )} seconds [${config.model}]. Try again or check the provider connection.`
      );
    }
    if (opts.signal?.aborted) {
      throw new DOMException("The request was aborted.", "AbortError");
    }
    if (error instanceof TypeError) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} could not reach model ${config.model}: ${error.message || "network request failed"}. Check your network or local server.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function getRetryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(5000, Math.max(0, seconds * 1000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(5000, Math.max(0, retryAt - Date.now()));
    }
  }
  return attempt === 0 ? 600 : 1200;
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  }
  if (delay === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function fetchWithTransientRetry(
  endpoint: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, init);
    } catch (error) {
      if (init.signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      if (attempt >= MAX_TRANSIENT_RETRIES || !(error instanceof TypeError)) {
        throw error;
      }
      await waitForRetry(attempt === 0 ? 600 : 1200, init.signal ?? undefined);
      continue;
    }

    if (
      response.ok ||
      !RETRYABLE_HTTP_STATUSES.has(response.status) ||
      attempt >= MAX_TRANSIENT_RETRIES
    ) {
      return response;
    }

    const delay = getRetryDelay(response, attempt);
    await response.body?.cancel();
    await waitForRetry(delay, init.signal ?? undefined);
  }
}

async function withConfiguredFallback<T>(
  opts: GeminiRequestOptions,
  request: (requestOptions: GeminiRequestOptions) => Promise<T>
): Promise<T> {
  try {
    return await request(opts);
  } catch (error) {
    if (
      !(error instanceof AiApiError) ||
      error.provider !== "gemini" ||
      typeof error.status !== "number" ||
      !RETRYABLE_HTTP_STATUSES.has(error.status) ||
      opts.modelId
    ) {
      throw error;
    }

    const currentModel = getProviderConfig(opts).model;
    const settings = loadAiSettings();
    const fallbackModel =
      opts.tier === "fast" ? settings.synthesisModel : settings.fastModel;
    if (!fallbackModel.trim() || fallbackModel === currentModel) throw error;

    try {
      return await request({ ...opts, modelId: fallbackModel });
    } catch (fallbackError) {
      const detail =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(
        `${error.message} Automatic fallback to ${fallbackModel} also failed: ${detail}`
      );
    }
  }
}

function getGeminiRequestBody(opts: GeminiRequestOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    temperature: getTemperature(opts),
  };
  if (opts.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.jsonSchema;
  }

  return {
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    generationConfig,
  };
}

function getOpenAiRequestBody(
  opts: GeminiRequestOptions,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const settings = loadAiSettings();
  const systemInstruction = opts.jsonSchema
    ? `${opts.systemInstruction}\nReturn a JSON object matching this schema: ${JSON.stringify(
        opts.jsonSchema
      )}`
    : opts.systemInstruction;
  return {
    model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: opts.userPrompt },
    ],
    temperature: getTemperature(opts),
    top_p: settings.localTopP,
    max_tokens: opts.maxOutputTokens,
    response_format: opts.jsonSchema ? { type: "json_object" } : undefined,
    stream,
  };
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String(part.text ?? "")
        : ""
    )
    .join("");
}

function getResponseText(
  provider: AiProvider,
  responseText: string
): { text: string; error?: string } {
  if (provider === "gemini") {
    const data = JSON.parse(responseText) as GeminiApiResponse;
    return {
      text:
        data.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("") ?? "",
      error: data.error?.message,
    };
  }

  const data = JSON.parse(responseText) as OpenAiApiResponse;
  return {
    text: extractTextContent(data.choices?.[0]?.message?.content),
    error: data.error?.message,
  };
}

async function generateGeminiTextOnce(
  opts: GeminiRequestOptions
): Promise<string> {
  const provider = opts.provider ?? loadAiSettings().provider;
  const requestOptions = prepareRequestOptions(opts, provider);
  const config = getProviderConfig(requestOptions);
  const isGemini = config.provider === "gemini";
  return withRequestTimeout(requestOptions, config, async (signal) => {
    const response = await fetchWithTransientRetry(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isGemini ? { "x-goog-api-key": config.apiKey! } : {}),
      },
      body: JSON.stringify(
        isGemini
          ? getGeminiRequestBody(requestOptions)
          : getOpenAiRequestBody(requestOptions, config.model, false)
      ),
      signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new AiApiError(
        config.provider,
        config.model,
        response.status,
        response.statusText,
        responseText
      );
    }

    let result: { text: string; error?: string };
    try {
      result = getResponseText(config.provider, responseText);
    } catch {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} returned an invalid JSON response for model ${config.model}.`
      );
    }
    if (result.error) {
      throw new Error(
        formatApiError(
          config.provider,
          config.model,
          response.status,
          response.statusText,
          JSON.stringify({ error: { message: result.error } })
        )
      );
    }
    if (!result.text) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} returned an empty response for model ${config.model}.`
      );
    }
    return result.text;
  });
}

export async function generateGeminiText(
  opts: GeminiRequestOptions
): Promise<string> {
  return withConfiguredFallback(opts, generateGeminiTextOnce);
}

function getStreamText(
  provider: AiProvider,
  model: string,
  payloadText: string
): string {
  const payload = JSON.parse(payloadText) as GeminiApiResponse &
    OpenAiApiResponse;
  if (payload.error) {
    throw new AiApiError(
      provider,
      model,
      (payload as GeminiApiResponse).error?.code ?? "stream",
      "",
      JSON.stringify({
        error: {
          message:
            payload.error.message ??
            payload.error.status ??
            "Unknown streaming error",
        },
      })
    );
  }
  if (provider === "gemini") {
    return (
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? ""
    );
  }
  return extractTextContent(payload.choices?.[0]?.delta?.content);
}

async function streamGeminiTextOnce(
  opts: GeminiRequestOptions,
  onChunk: (text: string) => void
): Promise<string> {
  const provider = opts.provider ?? loadAiSettings().provider;
  const requestOptions = prepareRequestOptions(opts, provider);
  const config = getProviderConfig(requestOptions);
  const isGemini = config.provider === "gemini";
  const endpoint = isGemini
    ? config.endpoint.replace(":generateContent", ":streamGenerateContent") +
      "?alt=sse"
    : config.endpoint;
  return withRequestTimeout(requestOptions, config, async (signal) => {
    const response = await fetchWithTransientRetry(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(isGemini ? { "x-goog-api-key": config.apiKey! } : {}),
      },
      body: JSON.stringify(
        isGemini
          ? getGeminiRequestBody(requestOptions)
          : getOpenAiRequestBody(requestOptions, config.model, true)
      ),
      signal,
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new AiApiError(
        config.provider,
        config.model,
        response.status,
        response.statusText,
        responseText
      );
    }
    if (!response.body) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} streaming response did not include a readable body.`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const resultChunks: string[] = [];
    let resultLength = 0;

    const consumeEvent = (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") return;
      let text: string;
      try {
        text = getStreamText(config.provider, config.model, data);
      } catch (error) {
        if (error instanceof SyntaxError) return;
        if (error instanceof AiApiError) throw error;
        throw new Error(
          formatApiError(
            config.provider,
            config.model,
            "stream",
            "",
            JSON.stringify({
              error: {
                message:
                  error instanceof Error ? error.message : "Unknown stream error",
              },
            })
          )
        );
      }
      if (text) {
        resultChunks.push(text);
        resultLength += text.length;
        onChunk(text);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) consumeEvent(event);
        if (done) {
          if (buffer.trim()) consumeEvent(buffer);
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (resultLength === 0) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} returned an empty streaming response for model ${config.model}.`
      );
    }
    return resultChunks.join("");
  });
}

export async function streamGeminiText(
  opts: GeminiRequestOptions,
  onChunk: (text: string) => void
): Promise<string> {
  return withConfiguredFallback(opts, (requestOptions) =>
    streamGeminiTextOnce(requestOptions, onChunk)
  );
}

function parseJsonResponse(raw: string): unknown {
  const withoutFences = raw
    .trim()
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const starts = [
    withoutFences.indexOf("{"),
    withoutFences.indexOf("["),
  ]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  const candidates = [
    withoutFences,
    ...starts.map((start) => {
      const closing = withoutFences[start] === "[" ? "]" : "}";
      const end = withoutFences.lastIndexOf(closing);
      return end > start ? withoutFences.slice(start, end + 1) : "";
    }),
  ].filter(Boolean);

  let initialError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      initialError ??= error;
    }
    try {
      return JSON.parse(repairJsonString(candidate)) as unknown;
    } catch (error) {
      initialError ??= error;
    }
  }
  throw initialError ?? new Error("No JSON value was found.");
}

function repairJsonString(input: string): string {
  const repaired: string[] = [];
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (!inString) {
      repaired.push(character);
      if (character === '"') inString = true;
      continue;
    }

    if (character === "\\") {
      const next = input[index + 1] ?? "";
      const isUnicodeEscape =
        next === "u" && /^[0-9a-f]{4}$/i.test(input.slice(index + 2, index + 6));
      if ('"\\/bfnrt'.includes(next) || isUnicodeEscape) {
        repaired.push(character, next);
        index += 1;
        if (isUnicodeEscape) {
          repaired.push(input.slice(index + 1, index + 5));
          index += 4;
        }
      } else {
        repaired.push("\\\\");
      }
      continue;
    }

    if (character === '"') {
      let nextIndex = index + 1;
      while (/\s/.test(input[nextIndex] ?? "") && nextIndex < input.length) {
        nextIndex += 1;
      }
      const next = input[nextIndex];
      if (next === undefined || [",", "}", "]", ":"].includes(next)) {
        repaired.push(character);
        inString = false;
      } else {
        repaired.push('\\"');
      }
      continue;
    }

    const code = character.charCodeAt(0);
    if (code < 0x20) {
      repaired.push(
        code === 0x0a
          ? "\\n"
          : code === 0x0d
            ? "\\r"
            : code === 0x09
              ? "\\t"
              : `\\u${code.toString(16).padStart(4, "0")}`
      );
    } else {
      repaired.push(character);
    }
  }

  return repaired.join("");
}

export function parseGeminiJson<T>(raw: string): T {
  return parseJsonResponse(raw) as T;
}

export async function generateGeminiJson<T>(
  opts: GeminiRequestOptions & { jsonSchema: Record<string, unknown> }
): Promise<T> {
  const raw = await generateGeminiText(opts);
  return parseOrRepairGeminiJson<T>(opts, raw);
}

export async function parseOrRepairGeminiJson<T>(
  opts: GeminiRequestOptions & { jsonSchema: Record<string, unknown> },
  raw: string
): Promise<T> {
  try {
    return parseGeminiJson<T>(raw);
  } catch (initialError) {
    const config = getProviderConfig(opts);
    try {
      const repaired = await generateGeminiText({
        ...opts,
        temperature: 0,
        maxOutputTokens: Math.min(
          opts.maxOutputTokens ?? 1200,
          config.provider === "openai-compatible"
            ? loadAiSettings().localMaxOutputTokens
            : 2400
        ),
        systemInstruction:
          "Repair the response into one valid JSON object matching the required schema. Preserve all valid information. Return JSON only, with no prose or markdown.",
        userPrompt: `Repair this response into valid JSON matching the schema.\nSchema: ${JSON.stringify(
          opts.jsonSchema
        )}\nResponse:\n${raw}`,
      });
      return parseGeminiJson<T>(repaired);
    } catch (repairError) {
      throw new Error(
        `${config.provider === "gemini" ? "Gemini" : "Local AI"} model ${config.model} returned invalid JSON and automatic repair failed: ${
          repairError instanceof Error
            ? repairError.message
            : initialError instanceof Error
              ? initialError.message
              : "Unknown repair error"
        }`
      );
    }
  }
}

export async function testGeminiConnection(options: {
  apiKey?: string;
  modelId?: string;
  provider?: AiProvider;
  baseUrl?: string;
} = {}): Promise<void> {
  const response = await generateGeminiText({
    tier: "fast",
    ...options,
    systemInstruction: "Reply with OK only.",
    userPrompt: "Connection test",
    temperature: 0,
  });
  if (!response.trim()) {
    throw new Error("AI connection test returned an empty response.");
  }
}
