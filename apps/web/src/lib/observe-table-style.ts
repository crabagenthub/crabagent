export const OBSERVE_TABLE_CLASSNAME =
  "observe-arco-table text-sm [&_.arco-table-th]:bg-[#f7f9fc] [&_.arco-table-th.arco-table-col-sorted]:bg-[#f7f9fc] " +
  "[&_.arco-table-header]:border-b [&_.arco-table-header]:border-neutral-200 dark:[&_.arco-table-header]:border-zinc-700 " +
  "[&_.arco-table-th-item]:!py-1.5 [&_.arco-table-col-has-sorter_.arco-table-cell-with-sorter]:!py-1.5 " +
  "[&_.arco-table-col-fixed-left-last::after]:shadow-none [&_.arco-table-col-fixed-left-last]:border-r-0 " +
  "[&_.arco-table-border-header-cell_thead_.arco-table-th:first-child]:!border-l-0 " +
  "[&_thead_.arco-table-tr:first-child_.arco-table-th.arco-table-col-fixed-left:first-child]:!border-l-0";

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
 * Arco Table 横向滚动：`scroll.x` 由组件在 `.arco-table-content-inner` 上处理 overflow，
 * 与列 `fixed: 'left' | 'right'` 配合才能正确固定列（见 Arco Table `scroll` / `column.fixed`）。
 */
export const OBSERVE_TABLE_SCROLL_X = { x: "max-content" as const };
