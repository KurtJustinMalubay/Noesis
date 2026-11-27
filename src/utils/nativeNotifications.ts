import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const NOTIFICATION_CONSENT_KEY = "noesis.native-notification-consent.v1";

export function hasNativeNotificationConsent(): boolean {
  if (!isTauri()) return false;
  try {
    return window.localStorage.getItem(NOTIFICATION_CONSENT_KEY) === "enabled";
  } catch (error) {
    console.error("Could not read native notification consent.", error);
    return false;
  }
}

export function grantNativeNotificationConsent(): boolean {
  if (!isTauri()) return false;
  try {
    window.localStorage.setItem(NOTIFICATION_CONSENT_KEY, "enabled");
    return true;
  } catch (error) {
    console.error("Could not save native notification consent.", error);
    return false;
  }
}

export async function sendNativeNotification(
  title: string,
  body: string
): Promise<boolean> {
  if (!hasNativeNotificationConsent()) return false;

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
