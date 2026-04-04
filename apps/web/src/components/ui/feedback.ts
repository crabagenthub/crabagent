"use client";

import "@/lib/arco-react19-setup";
import { Message } from "@arco-design/web-react";

type ToastPayload = string;

const defaultDurationMs = 2200;

function show(
  fn: (config: Parameters<typeof Message.success>[0]) => ReturnType<typeof Message.success>,
  content: ToastPayload,
) {
  return fn({
    content,
    duration: defaultDurationMs,
    showIcon: true,
    className: "rounded-xl",
  });
}

/** Arco Message 封装：时长与图标与全局 `ConfigProvider.locale` 一致。 */
export const toast = {
  success(content: ToastPayload) {
    return show(Message.success, content);
  },
  error(content: ToastPayload) {
    return show(Message.error, content);
  },
  info(content: ToastPayload) {
    return show(Message.info, content);
  },
  warning(content: ToastPayload) {
    return show(Message.warning, content);
  },
};
