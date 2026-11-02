import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/app.css";
import "./app/duo.css";
import "./app/nav.css";
import "./app/sheet.css";
import "./app/season.css";
import "./app/facts.css";
import "./app/player.css";
// Hellmodus zuletzt, damit sein Farbset alle anderen Dateien überschreibt
import "./app/theme-light.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
