import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";

interface UpdateIndicatorProps {
  onToast: (message: string) => void;
}

export function UpdateIndicator({ onToast }: UpdateIndicatorProps) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkInFlight = useRef(false);
  const initialCheckStarted = useRef(false);
  const installInFlight = useRef(false);

  const checkForUpdate = async (notify: boolean) => {
    if (!isTauri() || checkInFlight.current || installInFlight.current) return;
    checkInFlight.current = true;
    setIsChecking(true);
    try {
      const available = await check();
      setUpdate(available);
      setCheckError(null);
      if (notify) {
        onToast(
          available
            ? `Noesis ${available.version} is ready to install.`
            : "Noesis is up to date."
        );
      }
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
      if (notify) {
        onToast(
          `Could not check for updates: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } finally {
      checkInFlight.current = false;
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (initialCheckStarted.current) return;
    initialCheckStarted.current = true;
    void checkForUpdate(false);
  }, []);

  const installUpdate = async (available: Update) => {
    if (installInFlight.current || checkInFlight.current) return;
    installInFlight.current = true;
    setIsInstalling(true);
    setDownloadedBytes(0);
    setContentLength(null);
    try {
      await available.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setDownloadedBytes(0);
          setContentLength(event.data.contentLength ?? null);
        } else if (event.event === "Progress") {
          setDownloadedBytes((downloaded) => downloaded + event.data.chunkLength);
        }
      });
      setUpdate(null);
      if (!navigator.userAgent.toLowerCase().includes("windows")) {
        await relaunch();
      }
    } catch (error) {
      onToast(
        `Update installation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      installInFlight.current = false;
      setIsInstalling(false);
    }
  };

  if (!isTauri()) return null;

  const label = isInstalling
    ? contentLength
      ? `Updating ${Math.min(100, Math.round((downloadedBytes / contentLength) * 100))}%`
      : "Updating…"
    : update
      ? `Update ${update.version}`
      : "Check updates";

  return (
    <button
      type="button"
      onClick={() =>
        update
          ? void installUpdate(update)
          : void checkForUpdate(true)
      }
      disabled={isChecking || isInstalling}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-70 ${
        update
          ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
      }`}
      aria-label={update ? `Install Noesis ${update.version}` : "Check for updates"}
      title={
        update?.body ||
        (update
          ? `Install Noesis ${update.version}`
          : checkError
            ? `Update check failed: ${checkError}`
            : "Check for updates")
      }
    >
      {isChecking || isInstalling ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : update ? (
        <Download className="h-3.5 w-3.5" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
