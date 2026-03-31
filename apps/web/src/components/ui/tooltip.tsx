"use client"

import "@/lib/arco-react19-setup"
import { Tooltip as ArcoTooltip } from "@arco-design/web-react"
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react"
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react"

import { cn } from "@/lib/utils"

type Side = "top" | "bottom" | "left" | "right"

/** 注入给 `TooltipTrigger` 的 `render` 回调，便于与 Arco / 旧 Base UI 形态对齐 */
export type TooltipTriggerRenderProps = {
  className?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
}

type TooltipContextValue = {
  content: ReactNode
  contentClassName?: string
  side: Side
  delay: number
}

const TooltipContext = createContext<TooltipContextValue>({
  content: null,
  side: "top",
  delay: 0,
})

function TooltipProvider({ delay = 0, children }: { delay?: number; children?: ReactNode }) {
  const inherited = useContext(TooltipContext)
  return (
    <TooltipContext.Provider
      value={{
        content: inherited.content,
        contentClassName: inherited.contentClassName,
        side: inherited.side,
        delay,
      }}
    >
      {children}
    </TooltipContext.Provider>
  )
}

/** 需在 `Tooltip` 之前声明，以便解析 `<TooltipContent />` 子节点时 `child.type === TooltipContent` 成立。 */
function TooltipContent({
  className,
  side = "top",
  children,
}: {
  className?: string
  side?: Side
  sideOffset?: number
  align?: "center" | "start" | "end"
  alignOffset?: number
  children?: ReactNode
}) {
  return (
    <span data-slot="tooltip-content" data-side={side} className={cn(className)}>
      {children}
    </span>
  )
}

function Tooltip({ children }: { children?: ReactNode }) {
  const inherited = useContext(TooltipContext)
  let content: ReactNode = null
  let contentClassName: string | undefined
  let side: Side = "top"

  const triggerNodes = Children.map(children, (child) => {
    if (!isValidElement(child)) {
      return child
    }
    if (child.type === TooltipContent) {
      const p = child.props as {
        className?: string
        side?: Side
        children?: ReactNode
      }
      content = p.children ?? null
      contentClassName = p.className
      side = p.side ?? "top"
      return null
    }
    const slot = (child.props as { ["data-slot"]?: string })["data-slot"]
    if (slot === "tooltip-content") {
      content = (child.props as { children?: ReactNode }).children ?? null
      contentClassName = (child.props as { className?: string }).className
      side = (child.props as { side?: Side }).side ?? "top"
      return null
    }
    return child
  })

  return (
    <TooltipContext.Provider
      value={{
        content,
        contentClassName,
        side,
        delay: inherited.delay,
      }}
    >
      {triggerNodes}
    </TooltipContext.Provider>
  )
}

function TooltipTrigger({
  render,
  children,
  delay = 0,
}: {
  delay?: number
  render?: ((triggerProps: TooltipTriggerRenderProps) => ReactElement) | ReactElement
  children?: ReactNode
}) {
  const { content, contentClassName, side, delay: providerDelay } = useContext(TooltipContext)

  const triggerProps: TooltipTriggerRenderProps = {}

  const triggerNode =
    typeof render === "function"
      ? render(triggerProps)
      : render && isValidElement(render)
        ? cloneElement(render, {
            ...(render.props as Record<string, unknown>),
            ...triggerProps,
          } as never)
        : isValidElement(children)
          ? cloneElement(children, triggerProps as never)
          : (children as ReactNode)

  if (!triggerNode) {
    return null
  }

  return (
    <ArcoTooltip
      content={content}
      position={side}
      triggerProps={{
        mouseEnterDelay: (delay || providerDelay) / 1000,
      }}
      className={cn(
        "arco-tooltip arco-tooltip-light max-w-xs",
        "[&_.arco-tooltip-content]:rounded-md [&_.arco-tooltip-content]:px-3 [&_.arco-tooltip-content]:py-1.5 [&_.arco-tooltip-content]:text-xs",
        contentClassName,
      )}
    >
      {triggerNode}
    </ArcoTooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
