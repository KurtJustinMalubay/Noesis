import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  loadAiSettings,
  type AiProvider,
} from "./keyStore.ts";
import {
  hasStructuredContent,
  parseSafeJson,
} from "./jsonSafeParser.ts";
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
  return { provider, model, endpoint: endpoint.toString() };
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
  init: RequestInit,
  useNativeProxy = false
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
    ? `${opts.systemInstruction}\nReturn a JSON ${
        String(opts.jsonSchema.type).toUpperCase() === "ARRAY" ? "array" : "object"
      } matching this schema: ${JSON.stringify(
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
    let response = await fetchWithTransientRetry(config.endpoint, {
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
    }, !isGemini);
    if (shouldRetryWithoutJsonMode(requestOptions, config, response.status)) {
      const fallbackResponse = await fetchWithTransientRetry(
        config.endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            getOpenAiFallbackBody(requestOptions, config.model, false)
          ),
          signal,
        },
        true
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
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(isGemini ? { "x-goog-api-key": config.apiKey! } : {}),
    };
    if (!isGemini && isTauri()) {
      const resultChunks: string[] = [];
      let streamError: unknown = null;
      const handleEvent = (event: string) => {
        if (signal.aborted || !event || event === "[DONE]") return;
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
            headers: {
              "Content-Type": "application/json",
            },
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
      if (resultChunks.length > 0) return resultChunks.join("");

      const responseText = await response.text();
      let result: { text: string; error?: string };
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
      onChunk(result.text);
      return result.text;
    }

    let response = await fetchWithTransientRetry(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        isGemini
          ? getGeminiRequestBody(requestOptions)
          : getOpenAiRequestBody(requestOptions, config.model, true)
      ),
      signal,
    }, !isGemini);
    if (shouldRetryWithoutJsonMode(requestOptions, config, response.status)) {
      const fallbackResponse = await fetchWithTransientRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            getOpenAiFallbackBody(
              requestOptions,
              config.model,
              true
            )
          ),
          signal,
        },
        true
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

export async function fetchLocalModels(baseUrl: string): Promise<string[]> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid local AI base URL: ${baseUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Local AI base URL must use HTTP or HTTPS.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "");
  if (!path.endsWith("/models")) {
    if (!path.endsWith("/v1")) path += "/v1";
    path += "/models";
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";

  const response = await requestEndpoint(
    url.toString(),
    { method: "GET", headers: { Accept: "application/json" } },
    true
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Local model discovery failed (${response.status}): ${getErrorDetail(
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
