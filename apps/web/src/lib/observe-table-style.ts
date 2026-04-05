
export const OBSERVE_TABLE_FRAME_CLASSNAME = "min-w-0 overflow-hidden rounded-md border border-neutral-200/90 bg-white";

/** 下拉/浮层：与 `OBSERVE_TABLE_FRAME` 同色描边 */
export const OBSERVE_PANEL_BORDER_CLASSNAME =
  "border border-neutral-200/90 dark:border-zinc-700/80";

/**
 * 与表格外框、工具栏卡片同一套中性描边；用于 Arco outline 按钮需 `!` 覆盖 primary 色。
 * 悬停底略深于 `neutral-50`，与表格区视觉一致。
 */
export const OBSERVE_CONTROL_OUTLINE_CLASSNAME =
  "!border-neutral-200/90 hover:!border-neutral-200/90 active:!border-neutral-200/90 focus-visible:!border-neutral-200/90 " +
  "dark:!border-zinc-700/80 dark:hover:!border-zinc-700/80 dark:active:!border-zinc-700/80 dark:focus-visible:!border-zinc-700/80 " +
  "hover:bg-neutral-100 dark:hover:bg-zinc-800";

/** 工具栏图标悬停色（蓝 / 天蓝），与中性灰对比更明显 */
export const OBSERVE_TOOLBAR_ICON_HOVER_TINT =
  "transition-colors duration-150 group-hover/button:text-blue-600 dark:group-hover/button:text-sky-400";

/** 默认中性色 + 悬停（用于字段管理、刷新等） */
export const OBSERVE_TOOLBAR_ICON_HOVER =
  `text-neutral-500 dark:text-zinc-400 ${OBSERVE_TOOLBAR_ICON_HOVER_TINT}`;

export const OBSERVE_TOOLBAR_SEARCH_ICON_HOVER =
  "text-neutral-500 transition-colors duration-150 group-hover/search:text-blue-600 group-focus-within/search:text-blue-600 dark:text-zinc-500 dark:group-hover/search:text-sky-400 dark:group-focus-within/search:text-sky-400";

/**
 * Arco Table 横向滚动：`scroll.x` 由组件在 `.arco-table-content-inner` 上处理 overflow，
 * 与列 `fixed: 'left' | 'right'` 配合才能正确固定列（见 Arco Table `scroll` / `column.fixed`）。
 */
export const OBSERVE_TABLE_SCROLL_X = { x: "max-content" as const };
