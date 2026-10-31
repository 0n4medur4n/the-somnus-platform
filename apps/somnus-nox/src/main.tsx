import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./i18n/index.js";
import "./index.css";
import { applyTheme, storedTheme } from "./theme.js";

applyTheme(storedTheme());

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
