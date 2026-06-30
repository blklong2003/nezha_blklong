import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "../i18n";
import { RemoteApp } from "./RemoteApp";
import { bootstrapToken } from "./data/remoteSource";
// 复用桌面同一套主题 token + .session-prose 样式，保证渲染一致。
import "../App.css";

// 远程面板默认深色（移动端、锁屏友好）。
document.documentElement.classList.add("dark");
bootstrapToken();

// 注册 Service Worker：可安装到主屏 + 离线外壳 + 推送通道（push 发送端见 B5b）。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <RemoteApp />
    </I18nProvider>
  </React.StrictMode>,
);
