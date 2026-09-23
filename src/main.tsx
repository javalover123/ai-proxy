import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Show window after frontend renders to avoid white flash
requestAnimationFrame(() => {
  getCurrentWindow()
    .show()
    .catch(() => {});
});
