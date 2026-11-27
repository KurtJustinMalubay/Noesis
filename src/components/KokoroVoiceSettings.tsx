import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, Trash2, Volume2, VolumeX } from "lucide-react";
import {
  KOKORO_VOICE_OPTIONS,
  type KokoroVoiceId,
  type UserPreferences,
} from "../ai/keyStore";
import { speakText, stopSpeaking } from "../utils/speech";

interface KokoroStatus {
  modelReady: boolean;
  downloadedVoices: string[];
  modelSizeBytes: number;
  dataDir: string;
}

interface DownloadProgressPayload {
  stage: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number;
  voice: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function KokoroVoiceSettings({
  preferences,
  onUpdatePreferences,
  kokoroEnabled,
  onToast,
}: {
  preferences: UserPreferences;
  onUpdatePreferences: (next: UserPreferences) => void;
  kokoroEnabled: boolean;
  onToast: (message: string) => void;
}) {
  const [status, setStatus] = useState<KokoroStatus | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgressPayload | null>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  const refreshStatus = async () => {
    if (!isTauri()) return;
    try {
      const next = await invoke<KokoroStatus>("kokoro_model_status");
      setStatus(next);
      if (next.modelReady) {
        void invoke("kokoro_warmup", { voice: preferences.kokoroVoice }).catch(
          () => {}
        );
      }
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    if (!kokoroEnabled || !isTauri()) return;
    void refreshStatus();

    let unlisten: (() => void) | undefined;
    void listen<DownloadProgressPayload>(
      "kokoro://download-progress",
      (event) => {
        setDownloadProgress(event.payload);
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [kokoroEnabled]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const handleDownload = async () => {
    if (!isTauri()) {
      onToast("Kokoro model downloads require the desktop app.");
      return;
    }
    setIsDownloading(true);
    setDownloadProgress(null);
    try {
      const nextStatus = await invoke<KokoroStatus>("kokoro_download_model", {
        voice: preferences.kokoroVoice,
      });
      setStatus(nextStatus);
      onToast("Kokoro neural voice is ready.");
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : "Could not download Kokoro voice."
      );
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleDeleteModels = async () => {
    if (!isTauri()) return;
    try {
      await invoke("kokoro_delete_models");
      await refreshStatus();
      onToast("Removed downloaded Kokoro voice files.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTestVoice = () => {
    if (isTestingVoice) {
      stopSpeaking();
      setIsTestingVoice(false);
      return;
    }

    const sample =
      "Hello! This is how your Noesis study voice sounds during lessons and tutoring.";

    if (
      kokoroEnabled &&
      isTauri() &&
      status?.modelReady &&
      status.downloadedVoices.includes(preferences.kokoroVoice)
    ) {
      setIsTestingVoice(true);
      void invoke("kokoro_speak", {
        text: sample,
        voice: preferences.kokoroVoice,
        speed: preferences.kokoroSpeed,
      })
        .then(() => {
          setIsTestingVoice(false);
        })
        .catch((err) => {
          onToast(
            err instanceof Error
              ? `Kokoro failed (${err.message}); using system voice.`
              : `Kokoro failed (${String(err)}); using system voice.`
          );
          const started = speakText(sample, {
            rate: preferences.webSpeechRate,
            pitch: preferences.webSpeechPitch,
            onStart: () => setIsTestingVoice(true),
            onEnd: () => setIsTestingVoice(false),
            onError: (msg) => {
              setIsTestingVoice(false);
              onToast(msg);
            },
          });
          if (!started) setIsTestingVoice(false);
        });
      return;
    }

    setIsTestingVoice(true);
    const started = speakText(sample, {
      rate: preferences.webSpeechRate,
      pitch: preferences.webSpeechPitch,
      onStart: () => setIsTestingVoice(true),
      onEnd: () => setIsTestingVoice(false),
      onError: (msg) => {
        setIsTestingVoice(false);
        onToast(msg);
      },
    });
    if (!started) {
      setIsTestingVoice(false);
    }
  };

  const selectedVoiceDownloaded =
    status?.downloadedVoices.includes(preferences.kokoroVoice) ?? false;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-800">
              System / Windows Voice (Default Fallback)
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Used when Kokoro is disabled or if a neural voice model is not
              downloaded yet.
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestVoice}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            {isTestingVoice ? (
              <>
                <VolumeX className="h-3.5 w-3.5" />
                Stop
              </>
            ) : (
              <>
                <Volume2 className="h-3.5 w-3.5" />
                Test Voice
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Speed</span>
              <span>{preferences.webSpeechRate.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.1}
              value={preferences.webSpeechRate}
              onChange={(event) =>
                onUpdatePreferences({
                  ...preferences,
                  webSpeechRate: Number(event.target.value),
                })
              }
              className="w-full accent-[var(--color-accent-button)]"
            />
          </label>

          <label className="block">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Pitch</span>
              <span>{preferences.webSpeechPitch.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={1.5}
              step={0.1}
              value={preferences.webSpeechPitch}
              onChange={(event) =>
                onUpdatePreferences({
                  ...preferences,
                  webSpeechPitch: Number(event.target.value),
                })
              }
              className="w-full accent-[var(--color-accent-button)]"
            />
          </label>
        </div>
      </section>

      {!kokoroEnabled ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-3 text-[11px] leading-5 text-slate-600">
          Want natural offline neural speech? Enable{" "}
          <span className="font-semibold text-slate-800">
            Kokoro Voice (Neural TTS)
          </span>{" "}
          in <span className="font-semibold text-slate-800">Plugins</span> to
          download voice models on demand (~95 MB, stored outside the app
          installer).
        </div>
      ) : (
        <section className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-3.5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">
                  Kokoro Neural Voice
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    status?.modelReady && selectedVoiceDownloaded
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  {status?.modelReady && selectedVoiceDownloaded
                    ? `Ready · ${formatBytes(status.modelSizeBytes)}`
                    : "Model download required"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Models are downloaded on demand to your app data folder (~95 MB)
                to keep the installer small.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {status?.modelReady && (
                <button
                  type="button"
                  onClick={() => void handleDeleteModels()}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={isDownloading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-button)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-95 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {isDownloading
                  ? "Downloading..."
                  : !status?.modelReady
                    ? "Download Model (~95 MB)"
                    : !selectedVoiceDownloaded
                      ? "Download Voice (~0.5 MB)"
                      : "Re-verify Files"}
              </button>
            </div>
          </div>

          {isDownloading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-600">
                <span>
                  Downloading {downloadProgress?.stage ?? "files"}...
                </span>
                <span>{downloadProgress?.percent ?? 0}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-[var(--color-accent-button)] transition-all"
                  style={{ width: `${downloadProgress?.percent ?? 5}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-600">
                Voice
              </span>
              <select
                value={preferences.kokoroVoice}
                onChange={(event) =>
                  onUpdatePreferences({
                    ...preferences,
                    kokoroVoice: event.target.value as KokoroVoiceId,
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-[var(--color-accent-button)]"
              >
                {KOKORO_VOICE_OPTIONS.map((voice) => {
                  const downloaded = status?.downloadedVoices.includes(voice.id);
                  return (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                      {downloaded ? " ✓" : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span>Kokoro Speed</span>
                <span>{preferences.kokoroSpeed.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.1}
                value={preferences.kokoroSpeed}
                onChange={(event) =>
                  onUpdatePreferences({
                    ...preferences,
                    kokoroSpeed: Number(event.target.value),
                  })
                }
                className="mt-1.5 w-full accent-[var(--color-accent-button)]"
              />
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
