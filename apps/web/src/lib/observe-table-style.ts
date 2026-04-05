
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

/**
 * 工具栏 `group/ico` 子元素：悬停时图标/文案为近黑（暗色主题为近白，保证可读）。
 */
export const OBSERVE_TOOLBAR_HOVER_FG_ICO =
  "group-hover/ico:text-neutral-950 dark:group-hover/ico:text-zinc-50";

/**
 * 工具栏搜索框：悬停时输入文字与放大镜（父级需 `group/sch`）。
 */
export const OBSERVE_TOOLBAR_HOVER_FG_SCH =
  "group-hover/sch:text-neutral-950 dark:group-hover/sch:text-zinc-50";

/**
 * Arco Table 横向滚动：`scroll.x` 由组件在 `.arco-table-content-inner` 上处理 overflow，
 * 与列 `fixed: 'left' | 'right'` 配合才能正确固定列（见 Arco Table `scroll` / `column.fixed`）。
 */
export const OBSERVE_TABLE_SCROLL_X = { x: "max-content" as const };
