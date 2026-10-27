import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { NoticePopup } from "./notify";
import { installPointerDismiss } from "./pointerDismiss";
import "./styles.css";

installPointerDismiss();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <NoticePopup />
    </BrowserRouter>
  </StrictMode>,
);
