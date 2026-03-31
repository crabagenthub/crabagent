"use client";

/**
 * Arco 在 React 19 下需从 `react-dom/client` 注入 `createRoot`，
 * 否则 Message / Modal / Portal 等会回退到已移除的 `ReactDOM.render`。
 * 在任意客户端模块里，对 `@arco-design/web-react` 的静态 import 之前应先导入本模块。
 */
import "@arco-design/web-react/es/_util/react-19-adapter";
