import type { ComponentType, SVGProps } from "react";
import { LlmModelIcon } from "./custom/llm-model-icon";
import { MemoryBranchesIcon } from "./custom/memory-branches-icon";
import { ToolWrenchIcon } from "./custom/tool-wrench-icon";

/**
 * 集中登记自定义 SVG，便于按需引用与文档化。新增图标：在 ./custom/ 添加组件并在此导出键名。
 */
export const customIcons = {
  llmModel: LlmModelIcon,
  memoryBranches: MemoryBranchesIcon,
  toolWrench: ToolWrenchIcon,
} as const satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

export type CustomIconName = keyof typeof customIcons;
