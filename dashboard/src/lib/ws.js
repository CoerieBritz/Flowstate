import { invoke, isTauri } from "@tauri-apps/api/core";

export const WS_URL = "ws://localhost:8765";

export async function getWsToken() {
  // Obtain auth token. Inside Tauri it always comes from the Rust side.
  // VITE_WS_TOKEN is only read in the Vite dev server outside Tauri;
  // the import.meta.env.DEV guard lets the production build drop it.
  let token = "";
  if (isTauri()) {
    try {
      token = await invoke("get_ws_token");
    } catch (err) {
      console.error("get_ws_token failed:", err);
    }
  } else if (import.meta.env.DEV) {
    token = import.meta.env.VITE_WS_TOKEN || "";
  }
  return token;
}
