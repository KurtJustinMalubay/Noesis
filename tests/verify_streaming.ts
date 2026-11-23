import {
  fetchLocalModels,
  generateGeminiJson,
  generateGeminiText,
  parseGeminiJson,
  streamGeminiText,
} from "../src/ai/geminiClient.ts";
import {
  GEMINI_MODEL_OPTIONS,
  loadAiSettings,
} from "../src/ai/keyStore.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      key === "noesis.ai.settings.v1" ? storedAiSettings : null,
    setItem: () => {},
  },
});

const originalFetch = globalThis.fetch;
let storedAiSettings: string | null = null;
const receivedChunks: string[] = [];
let requestedUrl = "";
let requestedHeaders = new Headers();

function makeResponse(data: string): Response {
  const encoder = new TextEncoder();
  const byteStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = encoder.encode(data);
      for (let offset = 0; offset < bytes.length; offset += 7) {
        controller.enqueue(bytes.slice(offset, offset + 7));
      }
      controller.close();
    },
  });
  return new Response(byteStream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function run(): Promise<void> {
  try {
    const repairedJson = parseGeminiJson<{
      lesson_markdown: string;
      flashcards: Array<{ front: string; back: string }>;
    }>(
      '```json\n{"lesson_markdown":"# Lesson\nUse \\Sigma^* and printf("hello");\n```c\nint *pt = 0;\n```","flashcards":[]}\n```'
    );
    assert(
      repairedJson.lesson_markdown.includes("\\Sigma^*") &&
        repairedJson.lesson_markdown.includes('printf("hello")') &&
        repairedJson.lesson_markdown.includes("int *pt = 0;"),
      "fenced JSON should recover LaTeX backslashes, embedded quotes, and control characters"
    );

    assert(
      GEMINI_MODEL_OPTIONS.some(
        (model) => model.id === "gemini-4-hydrogen"
      ),
      "Gemini 4 Hydrogen should be available in the shared model list"
    );

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return makeResponse(
        [
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello " }] } }] })}\n\n`,
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "world." }] } }] })}\n\n`,
        ].join("")
      );
    }) as typeof fetch;

    const streamed = await streamGeminiText(
      {
        tier: "fast",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Stream",
      },
      (chunk) => receivedChunks.push(chunk)
    );
    assert(streamed === "Hello world.", "SSE text chunks should concatenate");
    assert(
      receivedChunks.join("") === streamed,
      "Each text delta should be delivered to the live callback"
    );
    assert(
      requestedUrl.includes(":streamGenerateContent?alt=sse"),
      "Gemini streaming endpoint should request SSE"
    );
    assert(
      requestedHeaders.get("x-goog-api-key") === "test-key" &&
        !requestedUrl.includes("key="),
      "Gemini API keys should be sent only through the request header"
    );

    globalThis.fetch = (async () =>
      makeResponse(
        `data: malformed-json\n\ndata: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Recovered partial" }] } }],
        })}`
      )) as typeof fetch;
    const recovered = await streamGeminiText(
      {
        tier: "fast",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Recover",
      },
      () => {}
    );
    assert(
      recovered === "Recovered partial",
      "Malformed events and a final unterminated SSE event should not discard valid text"
    );

    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Model OK" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const generated = await generateGeminiText({
      tier: "fast",
      modelId: "custom-fast-model",
      maxOutputTokens: 123,
      apiKey: "test-key",
      systemInstruction: "Test",
      userPrompt: "Model",
    });
    assert(generated === "Model OK", "JSON generation should return model text");
    assert(
      requestedUrl.includes("/models/custom-fast-model:generateContent"),
      "custom model IDs should be used in the request endpoint"
    );
    assert(
      !requestedUrl.includes("?") &&
        requestedHeaders.get("x-goog-api-key") === "test-key",
      "Gemini generation should use a clean endpoint and key header"
    );
    assert(
      JSON.stringify(requestBody).includes('"maxOutputTokens":123'),
      "generation requests should include the configured output token limit"
    );

    let structuredRequestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      structuredRequestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"lesson_markdown":"# Structured","mermaid_diagram":"","flashcards":[]}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const structured = await generateGeminiJson<{
      lesson_markdown: string;
      mermaid_diagram: string;
      flashcards: unknown[];
    }>({
      tier: "synthesis",
      apiKey: "test-key",
      systemInstruction: "Return JSON.",
      userPrompt: "Structured output",
      jsonSchema: {
        type: "OBJECT",
        properties: { lesson_markdown: { type: "STRING" } },
      },
    });
    const structuredConfig = structuredRequestBody?.generationConfig as
      | Record<string, unknown>
      | undefined;
    assert(
      structured.lesson_markdown === "# Structured" &&
        structuredConfig?.responseMimeType === "application/json" &&
        structuredConfig?.responseSchema !== undefined,
      "Gemini structured requests should enforce JSON MIME type and schema"
    );

    storedAiSettings = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      fastModel: "gemini-4-hydrogen",
      synthesisModel: "gemini-3.5-flash-lite",
    });
    const retryUrls: string[] = [];
    let unavailableAttempts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      retryUrls.push(url);
      if (url.includes("/models/gemini-3.5-flash-lite:")) {
        unavailableAttempts += 1;
        return new Response(
          JSON.stringify({
            error: { code: 503, status: "UNAVAILABLE", message: "Overloaded" },
          }),
          { status: 503, headers: { "Retry-After": "0" } }
        );
      }
      return makeResponse(
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Fallback succeeded" }] } }],
        })}\n\n`
      );
    }) as typeof fetch;
    const fallbackReply = await streamGeminiText(
      {
        tier: "synthesis",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Recover from service unavailable",
      },
      () => {}
    );
    assert(
      fallbackReply === "Fallback succeeded" &&
        unavailableAttempts === 2 &&
        retryUrls.some((url) => url.includes("/models/gemini-4-hydrogen:")),
      "503 responses should retry once and fail over to the configured alternate"
    );

    storedAiSettings = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      fastModel: "gemini-3.5-flash-lite",
      synthesisModel: "gemini-3.5-flash-lite",
    });
    const sameModelUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      sameModelUrls.push(url);
      if (url.includes("/models/gemini-3.5-flash-lite:")) {
        return new Response(
          JSON.stringify({
            error: { code: 503, status: "UNAVAILABLE", message: "Overloaded" },
          }),
          { status: 503, headers: { "Retry-After": "0" } }
        );
      }
      return makeResponse(
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Alternate model succeeded" }] } }],
        })}\n\n`
      );
    }) as typeof fetch;
    const alternateModelReply = await streamGeminiText(
      {
        tier: "synthesis",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Recover when both configured models match",
      },
      () => {}
    );
    assert(
      alternateModelReply === "Alternate model succeeded" &&
        sameModelUrls.some((url) => url.includes("/models/gemini-3.8-flash:")) &&
        !sameModelUrls.some((url) =>
          url.includes("/models/gemini-3.5-flash-lite:")
        ),
      "an overloaded model should be bypassed during cooldown and use a distinct supported fallback"
    );

    storedAiSettings = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      fastModel: "gemini-4-hydrogen",
      synthesisModel: "gemini-3.5-flash-lite",
    });
    const apiError = JSON.stringify({
      error: { code: 404, message: "Model not found" },
    });
    globalThis.fetch = (async () =>
      new Response(apiError, {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await generateGeminiText({
        tier: "fast",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Fail",
      });
      throw new Error("Expected Gemini API failure.");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message.includes(
            "Gemini API Error (404) [gemini-4-hydrogen]: Model not found"
          ),
        "API failures should surface status, model ID, and Google message"
      );
    }

    try {
      await streamGeminiText(
        {
          tier: "fast",
          apiKey: "test-key",
          systemInstruction: "Test",
          userPrompt: "Fail stream",
        },
        () => {}
      );
      throw new Error("Expected Gemini streaming API failure.");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message.includes(
            "Gemini API Error (404) [gemini-4-hydrogen]: Model not found"
          ),
        "stream failures should surface status, model ID, and Google message"
      );
    }

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { code: 505, message: "Unsupported HTTP version" },
        }),
        {
          status: 505,
          statusText: "HTTP Version Not Supported",
          headers: { "Content-Type": "application/json" },
        }
      )) as typeof fetch;
    try {
      await generateGeminiText({
        tier: "synthesis",
        modelId: "custom/synthesis model",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "505",
      });
      throw new Error("Expected Gemini HTTP 505 failure.");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message.includes(
            "Gemini API Error (505) [custom/synthesis model]: Unsupported HTTP version"
          ),
        "HTTP 505 diagnostics should preserve exact status, model, and API message"
      );
    }

    const abortController = new AbortController();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestSignal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const sendPartial = () => {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  candidates: [{ content: { parts: [{ text: "Partial" }] } }],
                })}\n\n`
              )
            );
          };
          if (requestSignal?.aborted) {
            controller.error(new DOMException("Aborted", "AbortError"));
            return;
          }
          sendPartial();
          requestSignal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    const abortableStream = streamGeminiText(
      {
        tier: "fast",
        apiKey: "test-key",
        systemInstruction: "Test",
        userPrompt: "Stop",
        signal: abortController.signal,
      },
      () => {}
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    abortController.abort();
    try {
      await abortableStream;
      throw new Error("Expected an aborted Gemini stream.");
    } catch (error) {
      assert(
        abortController.signal.aborted &&
          error instanceof Error &&
          error.name === "AbortError",
        "an abort signal should stop an active SSE response"
      );
    }

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      })) as typeof fetch;
    try {
      await generateGeminiText({
        tier: "fast",
        systemInstruction: "Test timeout",
        userPrompt: "Wait forever",
        timeoutMs: 20,
      });
      throw new Error("Expected the AI request to time out.");
    } catch (error) {
      assert(
        error instanceof Error && error.message.includes("timed out after"),
        "non-responsive AI endpoints should fail with a bounded timeout"
      );
    }

    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  candidates: [{ content: { parts: [{ text: "Partial" }] } }],
                })}\n\n`
              )
            );
            setTimeout(() => controller.error(new Error("connection lost")), 0);
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;
    try {
      await streamGeminiText(
        {
          tier: "fast",
          systemInstruction: "Test stream recovery",
          userPrompt: "Fail after a partial answer",
        },
        () => {}
      );
      throw new Error("Expected the partial stream to fail.");
    } catch (error) {
      assert(
        error instanceof Error && error.message.includes("connection lost"),
        "a stream interrupted after partial output must not resolve as success"
      );
    }

    storedAiSettings = JSON.stringify({
      provider: "openai-compatible",
      apiKey: "saved-gemini-secret",
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "qwen2.5",
    });
    let localRequestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      localRequestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Local model OK" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const localText = await generateGeminiText({
      tier: "fast",
      systemInstruction: "Test",
      userPrompt: "Local",
      maxOutputTokens: 77,
    });
    assert(localText === "Local model OK", "local chat completions should parse");
    assert(
      requestedUrl === "http://localhost:11434/v1/chat/completions",
      "local base URLs should resolve to the OpenAI-compatible chat endpoint"
    );
    assert(
      !requestedHeaders.has("x-goog-api-key") &&
        !requestedHeaders.has("Authorization") &&
        localRequestBody?.model === "qwen2.5" &&
        localRequestBody?.max_tokens === 77 &&
        localRequestBody?.temperature === 0.4 &&
        localRequestBody?.top_p === 0.9,
      "local requests should use the configured model without a Gemini key"
    );

    let discoveryHeaders = new Headers();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      discoveryHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ data: [{ id: "qwen2.5" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const discoveredModels = await fetchLocalModels(
      "http://127.0.0.1:11434/v1"
    );
    assert(
      discoveredModels[0] === "qwen2.5" &&
        !discoveryHeaders.has("Authorization"),
      "local model discovery must not forward a saved Gemini key"
    );

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      localRequestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Local bounded output" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    await generateGeminiText({
      tier: "synthesis",
      systemInstruction: "Long system context ".repeat(100),
      userPrompt: "Long user context ".repeat(300),
      maxOutputTokens: 2100,
    });
    const localMessages = localRequestBody?.messages as
      | Array<{ content: string }>
      | undefined;
    assert(
      localRequestBody?.max_tokens === 1200 &&
        Math.ceil(
          (localMessages?.reduce((sum, message) => sum + message.content.length, 0) ??
            0) / 4
        ) <= 720,
      "local output and input budgets should fit a 2048-token context without the old 600-token output ceiling"
    );

    storedAiSettings = JSON.stringify({
      provider: "openai-compatible",
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "qwen2.5",
      localContextWindowTokens: 4096,
      localMaxOutputTokens: 1600,
      localTemperature: 0.7,
      localTopP: 0.8,
    });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      localRequestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Customized local model OK" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    await generateGeminiText({
      tier: "synthesis",
      systemInstruction: "Long system context ".repeat(1000),
      userPrompt: "Long user context ".repeat(5000),
      maxOutputTokens: 2400,
    });
    const customizedMessages = localRequestBody?.messages as
      | Array<{ content: string }>
      | undefined;
    assert(
      localRequestBody?.max_tokens === 1600 &&
        localRequestBody?.temperature === 0.7 &&
        localRequestBody?.top_p === 0.8 &&
        Math.ceil(
          (customizedMessages?.reduce(
            (sum, message) => sum + message.content.length,
            0
          ) ?? 0) / 4
        ) <= 2368,
      "custom local context, output, and sampling settings should govern request construction"
    );

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      localRequestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Temperature override OK" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    await generateGeminiText({
      tier: "fast",
      systemInstruction: "Test",
      userPrompt: "Override",
      temperature: 0.1,
    });
    assert(
      localRequestBody?.temperature === 0.1 &&
        localRequestBody?.top_p === 0.8,
      "request-specific temperature should override the local default without changing top-p"
    );

    const localChunks: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return makeResponse(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Local " } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "stream." } }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join("")
      );
    }) as typeof fetch;
    const localStream = await streamGeminiText(
      {
        tier: "fast",
        systemInstruction: "Test",
        userPrompt: "Stream",
      },
      (chunk) => localChunks.push(chunk)
    );
    assert(
      localStream === "Local stream." &&
        localChunks.join("") === localStream &&
        requestedUrl.endsWith("/chat/completions") &&
        !requestedHeaders.has("Authorization"),
      "OpenAI-compatible SSE deltas should stream progressively"
    );

    let repairCalls = 0;
    globalThis.fetch = (async () => {
      repairCalls += 1;
      const content =
        repairCalls === 1 ? "not valid json" : '{"repaired":true}';
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const repaired = await generateGeminiJson<{ repaired: boolean }>({
      tier: "fast",
      systemInstruction: "Return JSON.",
      userPrompt: "Test repair",
      jsonSchema: {
        type: "OBJECT",
        properties: { repaired: { type: "BOOLEAN" } },
      },
    });
    assert(
      repaired.repaired && repairCalls === 2,
      "invalid local model JSON should trigger one automatic repair request"
    );

    storedAiSettings = JSON.stringify({
      provider: "openai-compatible",
      localBaseUrl: "http://192.168.1.25:1234/v1",
      localModel: "local-model",
      localTemperature: 0.9,
    });
    const structuredLocalBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      structuredLocalBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>
      );
      if (structuredLocalBodies.length === 1) {
        return new Response("Unsupported response_format", { status: 422 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"repaired":true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const localJsonModeResult = await generateGeminiJson<{
      repaired: boolean;
    }>({
      tier: "fast",
      systemInstruction: "Return JSON.",
      userPrompt: "Structured local request",
      temperature: 0.8,
      jsonSchema: {
        type: "OBJECT",
        properties: { repaired: { type: "BOOLEAN" } },
      },
    });
    assert(
      localJsonModeResult.repaired &&
        structuredLocalBodies.length === 2 &&
        structuredLocalBodies[0].temperature === 0.25 &&
        structuredLocalBodies[0].response_format !== undefined &&
        structuredLocalBodies[1].response_format === undefined,
      "structured local requests should clamp temperature and retry HTTP 422 without response_format"
    );

    storedAiSettings = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      fastModel: "gemini-4-hydrogen",
      synthesisModel: "gemini-3.5-flash-lite",
    });
    let geminiRepairCalls = 0;
    globalThis.fetch = (async () => {
      geminiRepairCalls += 1;
      const text =
        geminiRepairCalls === 1
          ? "not valid json"
          : '{"repaired":true}';
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const repairedGemini = await generateGeminiJson<{
      repaired: boolean;
    }>({
      tier: "fast",
      systemInstruction: "Return JSON.",
      userPrompt: "Test cloud repair",
      jsonSchema: {
        type: "OBJECT",
        properties: { repaired: { type: "BOOLEAN" } },
      },
    });
    assert(
      repairedGemini.repaired && geminiRepairCalls === 2,
      "malformed Gemini structured output should receive one bounded repair request"
    );

    storedAiSettings = JSON.stringify({
      fastModel: "gemini-2.5-flash-lite",
      synthesisModel: "gemini-2.5-flash",
    });
    const migratedSettings = loadAiSettings();
    assert(
      migratedSettings.fastModel === "gemini-4-hydrogen" &&
        migratedSettings.synthesisModel === "gemini-3.5-flash-lite",
      "deprecated saved model preferences should migrate to active fast defaults"
    );
    console.log("✓ Gemini SSE chunking and recovery tests passed!");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error("Streaming test failed:", error);
  process.exitCode = 1;
});
