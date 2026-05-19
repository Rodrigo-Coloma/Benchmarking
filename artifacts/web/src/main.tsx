import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setBaseUrl } from "@workspace/api-client-react";
import "./index.css";

// Resolver el base URL del API a partir del BASE_URL de Vite.
// Ej.: BASE_URL="/evidencias/" → API root = "/evidencias/api"
const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
setBaseUrl(apiBase);

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
