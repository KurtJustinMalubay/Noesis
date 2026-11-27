import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadUserPreferences } from "../ai/keyStore";
import { usePluginStore } from "../plugins/pluginStore";
import { KOKORO_TTS_PLUGIN_ID } from "../plugins/registry";

let speechGeneration = 0;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let pendingSpeakTimer: number | null = null;

export interface SpeakWordProgress {
  charIndex: number;
  charLength: number;
  word: string;
  totalChars: number;
}

let activeKokoroWordHandler: {
  generation: number;
  callback: (progress: SpeakWordProgress) => void;
} | null = null;
let kokoroWordListenerReady: Promise<void> | null = null;

function ensureKokoroWordListener(): Promise<void> {
  if (!kokoroWordListenerReady) {
    kokoroWordListenerReady = listen<SpeakWordProgress>(
      "kokoro://word-progress",
      (event) => {
        const active = activeKokoroWordHandler;
        if (active && speechGeneration === active.generation) {
          active.callback(event.payload);
        }
      }
    )
      .then(() => {})
      .catch((error: unknown) => {
        kokoroWordListenerReady = null;
        throw error;
      });
  }
  return kokoroWordListenerReady;
}

export function isTtsSupported(): boolean {
  const hasWebSpeech =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";
  return hasWebSpeech || isTauri();
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function stripMarkdownForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1 over $2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "square root of $1")
    .replace(/\\times/g, " times ")
    .replace(/\\cdot/g, " times ")
    .replace(/\\div/g, " divided by ")
    .replace(/\\pm/g, " plus or minus ")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SpeechSection {
  id: string;
  label: string;
  text: string;
  markdown: string;
}

export function splitMarkdownIntoSpeechSections(
  _title: string,
  markdown: string
): SpeechSection[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  const rawSections: Array<{ label: string; markdown: string; speechBody: string }> = [];
  let currentLabel = "Introduction";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      const sectionMd = currentLines.join("\n").trim();
      if (sectionMd) {
        rawSections.push({
          label: currentLabel,
          markdown: sectionMd,
          speechBody: sectionMd,
        });
      }
      currentLabel = stripMarkdownForSpeech(headingMatch[1]) || "Section";
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  const trailingMd = currentLines.join("\n").trim();
  if (trailingMd) {
    rawSections.push({
      label: currentLabel,
      markdown: trailingMd,
      speechBody: trailingMd,
    });
  }

  // If the lesson has only one large section without headings, split by paragraphs
  // so users can still skip forward and backward.
  if (rawSections.length === 1 && rawSections[0].markdown.length > 500) {
    const paragraphs = rawSections[0].markdown
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length > 1) {
      const grouped: string[] = [];
      let buffer = "";
      for (const p of paragraphs) {
        if (buffer && buffer.length + p.length > 480) {
          grouped.push(buffer);
          buffer = p;
        } else {
          buffer = buffer ? `${buffer}\n\n${p}` : p;
        }
      }
      if (buffer) grouped.push(buffer);

      return grouped.map((text, index) => ({
        id: `part-${index + 1}`,
        label: index === 0 ? "Introduction" : `Part ${index + 1}`,
        text,
        markdown: text,
      }));
    }
  }

  return rawSections.map((section, index) => {
    return {
      id: `section-${index + 1}`,
      label: section.label,
      text: section.speechBody,
      markdown: section.markdown,
    };
  });
}

export function stopSpeaking(): void {
  speechGeneration += 1;
  activeKokoroWordHandler = null;
  if (pendingSpeakTimer !== null) {
    window.clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }
  activeUtterance = null;
  if (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.speechSynthesis.cancel === "function" &&
    (window.speechSynthesis.speaking || window.speechSynthesis.pending)
  ) {
    window.speechSynthesis.cancel();
  }
  if (isTauri()) {
    void invoke("kokoro_stop").catch(() => {
      // Ignore if backend command is unavailable
    });
  }
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  onWord?: (progress: SpeakWordProgress) => void;
  rate?: number;
  pitch?: number;
}

export function speakText(
  rawText: string,
  callbacks: SpeakCallbacks = {}
): boolean {
  const hasWebSpeech =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";
  if (!hasWebSpeech) {
    callbacks.onError?.("Text-to-speech is not available on this device.");
    return false;
  }

  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) {
    callbacks.onEnd?.();
    return false;
  }

  if (pendingSpeakTimer !== null) {
    window.clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }

  const synth = window.speechSynthesis;
  const wasBusy = synth.speaking || synth.pending;
  if (wasBusy) {
    synth.cancel();
  }

  const myGen = speechGeneration;
  const startUtterance = () => {
    if (speechGeneration !== myGen) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = callbacks.rate ?? 1;
    utterance.pitch = callbacks.pitch ?? 1;
    utterance.onstart = () => {
      if (speechGeneration === myGen) callbacks.onStart?.();
    };
    utterance.onend = () => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (speechGeneration === myGen) callbacks.onEnd?.();
    };
    utterance.onboundary = (event) => {
      if (speechGeneration !== myGen) return;
      if (event.name && event.name !== "word") return;
      const start = event.charIndex;
      const tail = cleaned.slice(start);
      const match = tail.match(/^[A-Za-z0-9'’-]+/);
      const word = match?.[0] ?? "";
      if (!word) return;
      callbacks.onWord?.({
        charIndex: start,
        charLength: event.charLength || word.length,
        word,
        totalChars: cleaned.length,
      });
    };
    utterance.onerror = (event) => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (speechGeneration !== myGen) return;
      if (event.error === "interrupted" || event.error === "canceled") {
        callbacks.onEnd?.();
        return;
      }
      callbacks.onError?.("Could not play voice audio.");
    };

    activeUtterance = utterance;
    if (synth.paused) {
      synth.resume();
    }
    synth.speak(utterance);
  };

  if (wasBusy) {
    pendingSpeakTimer = window.setTimeout(() => {
      pendingSpeakTimer = null;
      startUtterance();
    }, 50);
  } else {
    startUtterance();
  }
  return true;
}

export function speakWithAppVoice(
  rawText: string,
  callbacks: Omit<SpeakCallbacks, "rate" | "pitch"> = {}
): boolean {
  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) {
    callbacks.onEnd?.();
    return false;
  }

  const prefs = loadUserPreferences();
  const kokoroEnabled = usePluginStore
    .getState()
    .enabledPluginIds.includes(KOKORO_TTS_PLUGIN_ID);

  if (!kokoroEnabled || !isTauri()) {
    return speakText(rawText, {
      ...callbacks,
      rate: prefs.webSpeechRate,
      pitch: prefs.webSpeechPitch,
    });
  }

  stopSpeaking();
  const myGen = speechGeneration;
  callbacks.onStart?.();

  void (async () => {
    try {
      if (callbacks.onWord) {
        activeKokoroWordHandler = {
          generation: myGen,
          callback: callbacks.onWord,
        };
        await ensureKokoroWordListener();
      }
      if (speechGeneration !== myGen) return;

      await invoke("kokoro_speak", {
        text: cleaned,
        voice: prefs.kokoroVoice,
        speed: prefs.kokoroSpeed,
      });
      if (activeKokoroWordHandler?.generation === myGen) {
        activeKokoroWordHandler = null;
      }
      if (speechGeneration === myGen) {
        callbacks.onEnd?.();
      }
    } catch {
      if (activeKokoroWordHandler?.generation === myGen) {
        activeKokoroWordHandler = null;
      }
      if (speechGeneration !== myGen) return;
      // Fallback to default Windows / browser Web Speech API if Kokoro model
      // isn't downloaded yet or fails for any reason.
      speakText(rawText, {
        ...callbacks,
        rate: prefs.webSpeechRate,
        pitch: prefs.webSpeechPitch,
      });
    }
  })();

  return true;
}

export function startDictation(callbacks: {
  onFinalTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}): () => void {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    callbacks.onError?.(
      "Voice input is not supported in this window. You can still type normally."
    );
    callbacks.onEnd?.();
    return () => {};
  }

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-US";

  let stoppedByCaller = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript ?? "";
      if (!transcript) continue;
      if (result.isFinal) {
        callbacks.onFinalTranscript(transcript.trim());
      } else {
        interim += transcript;
      }
    }
    callbacks.onInterimTranscript?.(interim.trim());
  };

  recognition.onerror = (event) => {
    if (stoppedByCaller || event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      callbacks.onError?.(
        "Microphone permission was denied. Allow mic access in system settings."
      );
    } else if (event.error === "audio-capture") {
      callbacks.onError?.("No microphone was detected.");
    } else if (event.error !== "no-speech") {
      callbacks.onError?.("Voice input stopped unexpectedly.");
    }
  };

  recognition.onend = () => {
    callbacks.onInterimTranscript?.("");
    callbacks.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    callbacks.onError?.("Could not start microphone listening.");
    callbacks.onEnd?.();
  }

  return () => {
    stoppedByCaller = true;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Ignore already-stopped instance
      }
    }
  };
}
