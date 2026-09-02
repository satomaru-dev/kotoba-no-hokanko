import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import { initialAuthReturn, supabase } from "./api";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js?v=7", { updateViaCache: "none" });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {supabase ? <AuthGate client={supabase} initialReturn={initialAuthReturn}>
      {(openSettings) => <App onPasswordSettings={openSettings} />}
    </AuthGate> : <App />}
  </StrictMode>
);
