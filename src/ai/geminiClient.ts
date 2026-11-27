import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  GEMINI_MODEL_OPTIONS,
  getOpenAiApiKey,
  getOpenAiPreset,
  loadAiSettings,
  type AiProvider,
} from "./keyStore.ts";
import {
  hasStructuredContent,
  parseSafeJson,
} from "./jsonSafeParser.ts";
import { fitRequestToProviderBudget } from "./tokenOptimizer.ts";
import {
  estimateAiTokens,
  recordAiUsage,
  type AiUsageFeature,
} from "./usage.ts";

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
  rateLimitMode?: "retry" | "fail-fast";
  feature?: AiUsageFeature;
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
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface OpenAiApiResponse {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  error?: { message?: string; code?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

interface ProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ProviderUsagePayload {
  usageMetadata?: GeminiApiResponse["usageMetadata"];
  usage?: OpenAiApiResponse["usage"];
  prompt_eval_count?: number;
  eval_count?: number;
}

function getTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function getProviderTokenUsage(
  provider: AiProvider,
  payload: ProviderUsagePayload
): ProviderTokenUsage | null {
  const inputTokens =
    provider === "gemini"
      ? getTokenCount(payload.usageMetadata?.promptTokenCount)
      : getTokenCount(
          payload.usage?.prompt_tokens ?? payload.prompt_eval_count
        );
  const reportedOutputTokens =
    provider === "gemini"
      ? getTokenCount(payload.usageMetadata?.candidatesTokenCount)
      : getTokenCount(payload.usage?.completion_tokens ?? payload.eval_count);
  const totalTokens =
    provider === "gemini"
      ? getTokenCount(payload.usageMetadata?.totalTokenCount)
      : getTokenCount(payload.usage?.total_tokens);
  const outputTokens =
    reportedOutputTokens ??
    (inputTokens !== null && totalTokens !== null
      ? Math.max(0, totalTokens - inputTokens)
      : null);
  return inputTokens !== null && outputTokens !== null
    ? { inputTokens, outputTokens }
    : null;
}

function getProviderUsageFromText(
  provider: AiProvider,
  responseText: string
): ProviderTokenUsage | null {
  try {
    return getProviderTokenUsage(
      provider,
      JSON.parse(responseText) as ProviderUsagePayload
    );
  } catch {
    return null;
  }
}

function inferAiUsageFeature(opts: GeminiRequestOptions): AiUsageFeature {
  if (opts.feature) return opts.feature;
  const text = `${opts.systemInstruction}\n${opts.userPrompt}`.toLowerCase();
  if (/\b(quiz|question|mcq|rubric|grading|grade)\b/.test(text)) {
    return "quizzes";
  }
  if (/\b(tutor|socratic|explain to the student|study coach)\b/.test(text)) {
    return "tutor";
  }
  if (/\b(lesson|worked example|curriculum|concept)\b/.test(text)) {
    return "lessons";
  }
  return "other";
}

function recordResponseUsage(
  opts: GeminiRequestOptions,
  text: string,
  usage: ProviderTokenUsage | null
): void {
  const estimatedInputTokens = estimateAiTokens(
    `${opts.systemInstruction}\n${opts.userPrompt}\n${
      opts.jsonSchema ? JSON.stringify(opts.jsonSchema) : ""
    }`
  );
  recordAiUsage({
    inputTokens: usage?.inputTokens ?? estimatedInputTokens,
    outputTokens: usage?.outputTokens ?? estimateAiTokens(text),
    isEstimated: usage === null,
    feature: inferAiUsageFeature(opts),
  });
}

interface ProviderConfig {
  provider: AiProvider;
  model: string;
  endpoint: string;
  apiKey?: string;
}

interface LocalProxyResponse {
  status: number;
  status_text: string;
  body: string;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}

async function requestEndpoint(
  endpoint: string,
  init: RequestInit,
  useNativeProxy: boolean
): Promise<Response> {
  if (!useNativeProxy || !isTauri()) return fetch(endpoint, init);
  if (init.signal?.aborted) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const result = await abortable(invoke<LocalProxyResponse>("local_ai_request", {
    url: endpoint,
    method: init.method ?? "GET",
    headers,
    body: typeof init.body === "string" ? init.body : null,
  }), init.signal ?? undefined);
  if (init.signal?.aborted) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.status_text,
    headers: { "Content-Type": "application/json" },
  });
}

async function requestNativeStream(
  endpoint: string,
  init: RequestInit,
  onEvent: (event: string) => void
): Promise<Response> {
  const channel = new Channel<string>();
  channel.onmessage = onEvent;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const result = await abortable(invoke<LocalProxyResponse>("local_ai_stream", {
    url: endpoint,
    headers,
    body: typeof init.body === "string" ? init.body : "",
    onEvent: channel,
  }), init.signal ?? undefined);
  if (init.signal?.aborted) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.status_text,
    headers: { "Content-Type": "application/json" },
  });
}

function getProviderConfig(opts: GeminiRequestOptions): ProviderConfig {
  const settings = loadAiSettings();
  const provider = opts.provider ?? settings.provider;
  const model =
    opts.modelId ??
    (provider === "openai-compatible"
      ? opts.tier === "fast"
        ? settings.openAiFastModel || settings.localModel
        : settings.openAiSynthesisModel || settings.localModel
      : opts.tier === "fast"
        ? settings.fastModel
        : settings.synthesisModel);
  if (!model.trim()) {
    throw new Error(
      provider === "openai-compatible"
        ? "Set an OpenAI-compatible model name in Settings before making a request."
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
    throw new Error(`Invalid OpenAI-compatible base URL: ${baseUrl}`);
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("OpenAI-compatible base URL must use HTTP or HTTPS.");
  }
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  if (/\/v\d+\/chat\/completions$/i.test(basePath)) {
    endpoint.pathname = basePath;
  } else {
    const apiPath = !basePath
      ? "/v1"
      : /\/v\d+$/i.test(basePath)
        ? basePath
        : `${basePath}/v1`;
    endpoint.pathname = `${apiPath}/chat/completions`;
  }
  endpoint.search = "";
  endpoint.hash = "";
  const apiKey = (opts.apiKey ?? getOpenAiApiKey(settings)).trim();
  const preset = getOpenAiPreset(settings.openAiPreset);
  if (!opts.baseUrl && preset.requiresApiKey && !apiKey) {
    throw new Error(
      `Missing ${preset.label} API key. Open Settings to paste your API key.`
    );
  }
  return {
    provider,
    model,
    endpoint: endpoint.toString(),
    apiKey: apiKey || undefined,
  };
}

function getOpenAiHeaders(
  endpoint: string,
  apiKey?: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  if (endpoint.toLowerCase().includes("openrouter.ai")) {
    headers["X-Title"] = "Noesis";
  }
  return headers;
}

export function isLocalAiEndpoint(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname)
  ) {
    return true;
  }

  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

function getTemperature(opts: GeminiRequestOptions): number {
  const settings = loadAiSettings();
  const provider = opts.provider ?? settings.provider;
  const temperature =
    opts.temperature ??
    (provider === "openai-compatible"
      ? settings.localTemperature
      : settings.creativityPreset === "focused"
        ? 0.2
        : settings.creativityPreset === "exploratory"
          ? 0.75
          : 0.4);
  if (
    provider === "openai-compatible" &&
    opts.jsonSchema &&
    isLocalAiEndpoint(opts.baseUrl ?? settings.localBaseUrl)
  ) {
    return Math.min(0.25, temperature);
  }
  return temperature;
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
  const name = provider === "gemini" ? "Gemini" : "OpenAI-compatible AI";
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
const GEMINI_OVERLOAD_COOLDOWN_MS = 60_000;
const overloadedGeminiModels = new Map<string, number>();

export function getLocalOutputTokenBudget(requestedOutputTokens?: number): number {
  const settings = loadAiSettings();
  const configuredOutputLimit = Math.min(
    settings.localMaxOutputTokens,
    settings.localContextWindowTokens -
      LOCAL_CONTEXT_SAFETY_TOKENS -
      LOCAL_MIN_INPUT_TOKENS
  );
  return Math.max(
    1,
    Math.min(
      requestedOutputTokens ?? settings.localMaxOutputTokens,
      configuredOutputLimit
    )
  );
}

export function isTransientGeminiApiError(error: unknown): boolean {
  if (error instanceof AiApiError) {
    return (
      error.provider === "gemini" &&
      typeof error.status === "number" &&
      RETRYABLE_HTTP_STATUSES.has(error.status)
    );
  }
  return (
    error instanceof Error &&
    /Gemini API Error \((?:429|500|502|503|504)\)/.test(error.message)
  );
}

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
  const maxOutputTokens = getLocalOutputTokenBudget(opts.maxOutputTokens);
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
      return Math.min(30_000, Math.max(0, seconds * 1000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(30_000, Math.max(0, retryAt - Date.now()));
    }
  }
  return Math.min(8000, 1000 * 2 ** attempt);
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
  init: RequestInit,
  useNativeProxy = false,
  rateLimitMode: GeminiRequestOptions["rateLimitMode"] = "retry"
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await requestEndpoint(endpoint, init, useNativeProxy);
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

    const retryLimit =
      response.status === 429 && rateLimitMode === "fail-fast"
        ? 0
        : response.status === 503
          ? 4
          : MAX_TRANSIENT_RETRIES;
    if (
      response.ok ||
      !RETRYABLE_HTTP_STATUSES.has(response.status) ||
      attempt >= retryLimit
    ) {
      return response;
    }

    const delay = getRetryDelay(response, attempt);
    await response.body?.cancel();
    await waitForRetry(delay, init.signal ?? undefined);
  }
}

function getGeminiModelCooldown(model: string): number | null {
  const cooldownUntil = overloadedGeminiModels.get(model);
  if (!cooldownUntil) return null;
  if (cooldownUntil <= Date.now()) {
    overloadedGeminiModels.delete(model);
    return null;
  }
  return cooldownUntil;
}

function isGeminiModelCoolingDown(model: string): boolean {
  return getGeminiModelCooldown(model) !== null;
}

function markGeminiModelOverloaded(model: string): void {
  overloadedGeminiModels.set(model, Date.now() + GEMINI_OVERLOAD_COOLDOWN_MS);
}

function getFallbackGeminiModel(
  opts: GeminiRequestOptions,
  currentModel: string
): string | undefined {
  const settings = loadAiSettings();
  const configuredFallback =
    opts.tier === "fast" ? settings.synthesisModel : settings.fastModel;
  const defaultFallbacks =
    opts.tier === "synthesis"
      ? ["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-3.1-flash-lite"]
      : ["gemini-4-hydrogen", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
  return [
    configuredFallback,
    ...defaultFallbacks,
    ...GEMINI_MODEL_OPTIONS.map(({ id }) => id),
  ].find(
    (model) =>
      model.trim() &&
      model !== currentModel &&
      !isGeminiModelCoolingDown(model)
  );
}

function isRetryableGeminiError(error: unknown): error is AiApiError {
  return (
    error instanceof AiApiError &&
    error.provider === "gemini" &&
    typeof error.status === "number" &&
    RETRYABLE_HTTP_STATUSES.has(error.status)
  );
}

export function isRateLimitApiError(error: unknown): boolean {
  if (error instanceof AiApiError) {
    return error.status === 429;
  }
  return error instanceof Error && /API Error \(429\)/.test(error.message);
}

async function withConfiguredFallback<T>(
  opts: GeminiRequestOptions,
  request: (requestOptions: GeminiRequestOptions) => Promise<T>
): Promise<T> {
  if ((opts.provider ?? loadAiSettings().provider) !== "gemini" || opts.modelId) {
    return request(opts);
  }

  const currentModel = getProviderConfig(opts).model;
  let primaryError: unknown;
  const cooldownUntil = getGeminiModelCooldown(currentModel);
  if (cooldownUntil !== null) {
    const remainingSeconds = Math.ceil(
      (cooldownUntil - Date.now()) / 1000
    );
    primaryError = new Error(
      `Gemini model ${currentModel} is temporarily paused after an overload. Try again in about ${remainingSeconds} seconds.`
    );
  } else {
    try {
      return await request(opts);
    } catch (error) {
      if (!isRetryableGeminiError(error)) throw error;
      if (error.status === 429 && opts.rateLimitMode === "fail-fast") {
        throw error;
      }
      if (error.status === 503) markGeminiModelOverloaded(currentModel);
      primaryError = error;
    }
  }

  const fallbackModel = getFallbackGeminiModel(opts, currentModel);
  if (!fallbackModel) throw primaryError;

  try {
    return await request({ ...opts, modelId: fallbackModel });
  } catch (fallbackError) {
    if (
      fallbackError instanceof AiApiError &&
      fallbackError.provider === "gemini" &&
      fallbackError.status === 503
    ) {
      markGeminiModelOverloaded(fallbackModel);
    }
    const primaryDetail =
      primaryError instanceof Error ? primaryError.message : String(primaryError);
    const fallbackDetail =
      fallbackError instanceof Error
        ? fallbackError.message
        : String(fallbackError);
    throw new Error(
      `${primaryDetail} Automatic fallback to ${fallbackModel} also failed: ${fallbackDetail}`
    );
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

function toStandardJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      result[key] = value.toLowerCase();
    } else if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] =
          propVal && typeof propVal === "object" && !Array.isArray(propVal)
            ? toStandardJsonSchema(propVal as Record<string, unknown>)
            : propVal;
      }
      result[key] = props;
    } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = toStandardJsonSchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  if (result.type === "object") {
    if (!("additionalProperties" in result)) {
      result.additionalProperties = false;
    }
    if (
      result.properties &&
      typeof result.properties === "object" &&
      !Array.isArray(result.properties)
    ) {
      result.required = Object.keys(result.properties as Record<string, unknown>);
    }
  }
  return result;
}

function getOpenAiRequestBody(
  opts: GeminiRequestOptions,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const settings = loadAiSettings();
  const systemInstruction = opts.jsonSchema
    ? `${opts.systemInstruction}\nReturn ONLY valid JSON matching this schema: ${JSON.stringify(
        toStandardJsonSchema(opts.jsonSchema)
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
    response_format: opts.jsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: "noesis_response",
            strict: true,
            schema: toStandardJsonSchema(opts.jsonSchema),
          },
        }
      : undefined,
    stream,
  };
}

function getOpenAiFallbackBody(
  opts: GeminiRequestOptions,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const body = getOpenAiRequestBody(opts, model, stream);
  const completionTokens = body.max_completion_tokens;
  delete body.top_p;
  delete body.response_format;
  delete body.max_completion_tokens;
  if (body.max_tokens === undefined && typeof completionTokens === "number") {
    body.max_tokens = completionTokens;
  }
  return body;
}

function shouldRetryWithoutJsonMode(
  opts: GeminiRequestOptions,
  config: ProviderConfig,
  status: number
): boolean {
  return (
    config.provider === "openai-compatible" &&
    (status === 400 ||
      (status === 422 &&
        Boolean(opts.jsonSchema) &&
        isLocalAiEndpoint(config.endpoint)))
  );
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
): { text: string; error?: string; usage: ProviderTokenUsage | null } {
  if (provider === "gemini") {
    const data = JSON.parse(responseText) as GeminiApiResponse;
    return {
      text:
        data.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("") ?? "",
      error: data.error?.message,
      usage: getProviderTokenUsage(provider, data),
    };
  }

  const data = JSON.parse(responseText) as OpenAiApiResponse;
  return {
    text: extractTextContent(data.choices?.[0]?.message?.content),
    error: data.error?.message,
    usage: getProviderTokenUsage(provider, data),
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
    const headers = isGemini
      ? {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey!,
        }
      : getOpenAiHeaders(config.endpoint, config.apiKey);
    let response = await fetchWithTransientRetry(
      config.endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          isGemini
            ? getGeminiRequestBody(requestOptions)
            : getOpenAiRequestBody(requestOptions, config.model, false)
        ),
        signal,
      },
      !isGemini,
      requestOptions.rateLimitMode
    );
    if (shouldRetryWithoutJsonMode(requestOptions, config, response.status)) {
      const fallbackResponse = await fetchWithTransientRetry(
        config.endpoint,
        {
          method: "POST",
          headers: getOpenAiHeaders(config.endpoint, config.apiKey),
          body: JSON.stringify(
            getOpenAiFallbackBody(requestOptions, config.model, false)
          ),
          signal,
        },
        true,
        requestOptions.rateLimitMode
      );
      response = fallbackResponse;
    }
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

    let result: {
      text: string;
      error?: string;
      usage: ProviderTokenUsage | null;
    };
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
    recordResponseUsage(requestOptions, result.text, result.usage);
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
    const headers = isGemini
      ? {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-goog-api-key": config.apiKey!,
        }
      : getOpenAiHeaders(config.endpoint, config.apiKey, {
          Accept: "text/event-stream",
        });
    if (!isGemini && isTauri()) {
      const resultChunks: string[] = [];
      let streamError: unknown = null;
      let streamUsage: ProviderTokenUsage | null = null;
      const handleEvent = (event: string) => {
        if (signal.aborted || !event || event === "[DONE]") return;
        streamUsage =
          getProviderUsageFromText(config.provider, event) ?? streamUsage;
        try {
          const text = getStreamText(config.provider, config.model, event);
          if (text) {
            resultChunks.push(text);
            onChunk(text);
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) streamError = error;
        }
      };
      let response = await requestNativeStream(
        endpoint,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            getOpenAiRequestBody(requestOptions, config.model, true)
          ),
          signal,
        },
        handleEvent
      );
      if (shouldRetryWithoutJsonMode(requestOptions, config, response.status)) {
        const fallbackResponse = await requestEndpoint(
          endpoint,
          {
            method: "POST",
            headers: getOpenAiHeaders(config.endpoint, config.apiKey),
            body: JSON.stringify(
              getOpenAiFallbackBody(requestOptions, config.model, false)
            ),
            signal,
          },
          true
        );
        response = fallbackResponse;
        resultChunks.length = 0;
      }
      if (!response.ok) {
        throw new AiApiError(
          config.provider,
          config.model,
          response.status,
          response.statusText,
          await response.text()
        );
      }
      if (streamError) throw streamError;
      if (resultChunks.length > 0) {
        const text = resultChunks.join("");
        recordResponseUsage(requestOptions, text, streamUsage);
        return text;
      }

      const responseText = await response.text();
      let result: {
        text: string;
        error?: string;
        usage: ProviderTokenUsage | null;
      };
      try {
        result = getResponseText(config.provider, responseText);
      } catch {
        throw new Error(
          `Local AI returned an invalid JSON or streaming response for model ${config.model}.`
        );
      }
      if (result.error || !result.text) {
        throw new Error(
          formatApiError(
            config.provider,
            config.model,
            response.status,
            response.statusText,
            JSON.stringify({ error: { message: result.error ?? "Empty response" } })
          )
        );
      }
      recordResponseUsage(requestOptions, result.text, result.usage);
      onChunk(result.text);
      return result.text;
    }

    let response = await fetchWithTransientRetry(
      endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          isGemini
            ? getGeminiRequestBody(requestOptions)
            : getOpenAiRequestBody(requestOptions, config.model, true)
        ),
        signal,
      },
      !isGemini,
      requestOptions.rateLimitMode
    );
    if (shouldRetryWithoutJsonMode(requestOptions, config, response.status)) {
      const fallbackResponse = await fetchWithTransientRetry(
        endpoint,
        {
          method: "POST",
          headers: getOpenAiHeaders(config.endpoint, config.apiKey),
          body: JSON.stringify(
            getOpenAiFallbackBody(
              requestOptions,
              config.model,
              true
            )
          ),
          signal,
        },
        true,
        requestOptions.rateLimitMode
      );
      response = fallbackResponse;
    }
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
    let streamUsage: ProviderTokenUsage | null = null;

    const consumeEvent = (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") return;
      streamUsage =
        getProviderUsageFromText(config.provider, data) ?? streamUsage;
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

    const STREAM_IDLE_TIMEOUT_MS = 35_000;
    try {
      while (true) {
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) => {
          idleTimer = setTimeout(() => {
            reject(
              new Error(
                `${config.provider === "gemini" ? "Gemini" : "Local AI"} stream stalled for ${STREAM_IDLE_TIMEOUT_MS / 1000}s.`
              )
            );
          }, STREAM_IDLE_TIMEOUT_MS);
        });
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await Promise.race([readPromise, timeoutPromise]);
        } finally {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
        }
        const { done, value } = readResult;
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
    const text = resultChunks.join("");
    recordResponseUsage(requestOptions, text, streamUsage);
    return text;
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

export function parseGeminiJson<T>(raw: string): T {
  return parseSafeJson<T>(raw);
}

function parseStructuredJson<T>(
  raw: string,
  schema: Record<string, unknown>
): T {
  return parseSafeJson<T>(raw, {
    expectArray: String(schema.type).toUpperCase() === "ARRAY",
  });
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
    const parsed = parseStructuredJson<T>(raw, opts.jsonSchema);
    if (!hasStructuredContent(parsed)) {
      throw new Error("The model returned no valid structured items.");
    }
    return parsed;
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
          "Return ONLY valid compact JSON matching the exact schema. Escape all quotes and newlines inside strings. No markdown fences or prose.",
        userPrompt: `Repair this response into valid JSON matching the schema.\nSchema: ${JSON.stringify(
          opts.jsonSchema
        )}\nResponse:\n${raw}`,
      });
      const parsed = parseStructuredJson<T>(repaired, opts.jsonSchema);
      if (!hasStructuredContent(parsed)) {
        throw new Error("The repair response contained no valid structured items.");
      }
      return parsed;
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

export async function fetchLocalModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid OpenAI-compatible base URL: ${baseUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OpenAI-compatible base URL must use HTTP or HTTPS.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "");
  if (!path.endsWith("/models")) {
    if (!/\/v\d+$/i.test(path)) path += "/v1";
    path += "/models";
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  const response = await requestEndpoint(
    url.toString(),
    { method: "GET", headers },
    true
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Model discovery failed (${response.status}): ${getErrorDetail(
        responseText,
        response.statusText
      )}`
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch (error) {
    throw new Error(
      `Local model discovery returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Local model discovery response must be an object.");
  }
  const record = payload as Record<string, unknown>;
  const models = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;
  if (!models) throw new Error("Local model response did not contain a model list.");
  return models
    .map((model) => {
      if (typeof model === "string") return model.trim();
      if (model && typeof model === "object") {
        const item = model as Record<string, unknown>;
        const id = item.id ?? item.name;
        return typeof id === "string" ? id.trim() : "";
      }
      return "";
    })
    .filter((model, index, list) => Boolean(model) && list.indexOf(model) === index);
}

export const fetchOpenAiModels = fetchLocalModels;
