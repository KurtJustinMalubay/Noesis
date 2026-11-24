import { getCurrentWindow } from "@tauri-apps/api/window";

export async function setNativeFullscreen(enabled: boolean): Promise<boolean> {
  const window = getCurrentWindow();
  await window.setFullscreen(enabled);
  return window.isFullscreen();
}

export async function getNativeFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen();
}

export async function toggleNativeFullscreen(): Promise<boolean> {
  const window = getCurrentWindow();
  await window.setFullscreen(!(await window.isFullscreen()));
  return window.isFullscreen();
}
