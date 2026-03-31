"use client";

import ArcoAvatar from "@arco-design/web-react/es/Avatar";
import * as React from "react";
import type { Components } from "react-markdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import "@/lib/arco-react19-setup";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

export type MessageProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("flex gap-3", className)} {...props}>
    {children}
  </div>
);

export type MessageAvatarProps = {
  src: string;
  alt: string;
  fallback?: string;
  className?: string;
};

const MessageAvatar = ({ src, alt, fallback, className }: MessageAvatarProps) => {
  const [broken, setBroken] = React.useState(false);
  return (
    <ArcoAvatar className={cn("shrink-0", className)} size={32}>
      {!broken && src ? (
        // eslint-disable-next-line @next/next/no-img-element -- 会话头像任意 URL
        <img src={src} alt={alt} onError={() => setBroken(true)} />
      ) : (
        (fallback ?? (alt ? alt.slice(0, 1).toUpperCase() : "?"))
      )}
    </ArcoAvatar>
  );
};

export type MessageContentProps =
  | {
      markdown: true;
      children: string;
      className?: string;
      id?: string;
      components?: Partial<Components>;
    }
  | {
      markdown?: false;
      children: React.ReactNode;
      className?: string;
    } & Omit<React.HTMLProps<HTMLDivElement>, "children">;

const MessageContent = (props: MessageContentProps) => {
  const proseClasses =
    "prose prose-neutral max-w-none prose-p:my-1.5 prose-ol:my-2 prose-ul:my-2 dark:prose-invert";
  const shellClasses = "rounded-lg bg-secondary p-2 text-foreground break-words whitespace-normal";

  if ("markdown" in props && props.markdown === true) {
    const { children, className, id, components } = props;
    return (
      <Markdown className={cn(proseClasses, shellClasses, className)} id={id} components={components}>
        {children}
      </Markdown>
    );
  }

  // `markdown` is stripped from DOM — callers use markdown={false} for typing only
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit from ...rest
  const { children, className, markdown, ...rest } = props as Extract<
    MessageContentProps,
    { markdown?: false }
  >;
  return (
    <div className={cn(shellClasses, className)} {...rest}>
      {children}
    </div>
  );
};

export type MessageActionsProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-2 text-muted-foreground", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = {
  className?: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
} & React.ComponentProps<typeof Tooltip>;

const MessageAction = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}: MessageActionProps) => {
  const child = React.Children.only(children) as React.ReactElement<
    Record<string, unknown>
  >;

  return (
    <Tooltip {...props}>
      <TooltipTrigger
        delay={0}
        render={(triggerProps): React.ReactElement =>
          React.cloneElement(child, {
            ...(child.props as Record<string, unknown>),
            ...(triggerProps as Record<string, unknown>),
          } as never)
        }
      />
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction };
