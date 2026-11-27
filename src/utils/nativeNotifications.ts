import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch (error) {
    console.error("Could not request native notification permission.", error);
    return false;
  }
}

export async function sendNativeNotification(
  title: string,
  body: string
): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    if (!(await isPermissionGranted())) return false;
    sendNotification({ title, body });
    return true;
  } catch (error) {
    console.error("Could not send native notification.", error);
    return false;
  }
}

export function getImportantAppNotification(
  message: string
): { title: string; body: string } | null {
  if (
    /\b(?:update|install).*(?:ready|available|failed)|ready to install\b/i.test(
      message
    )
  ) {
    return {
      title: "Noesis update",
      body: "An update needs your attention. Open Noesis to review it.",
    };
  }

  if (/\b(?:error|failed|unable to|could not|unavailable)\b/i.test(message)) {
    return {
      title: "Noesis",
      body: "An issue needs your attention. Open Noesis to review the details.",
    };
  }

  return null;
}
