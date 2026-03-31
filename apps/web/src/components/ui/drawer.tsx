"use client";

import "@/lib/arco-react19-setup";
import { Drawer as ArcoDrawer } from "@arco-design/web-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const DrawerCloseContext = React.createContext<(() => void) | null>(null);

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
};

export function Drawer({ open, onOpenChange, children, className }: DrawerProps) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <DrawerCloseContext.Provider value={close}>
      <ArcoDrawer
        visible={open}
        onCancel={() => onOpenChange(false)}
        placement="right"
        width="min(100vw - 0.5rem, 80rem)"
        title={null}
        footer={null}
        closable={false}
        maskClosable
        escToExit
        mountOnEnter
        className={cn("ca-arco-app-drawer !bg-background", className)}
        bodyStyle={{
          padding: 0,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        maskStyle={{ background: "rgba(0, 0, 0, 0.06)" }}
        wrapClassName="ca-arco-app-drawer-wrap"
      >
        {children}
      </ArcoDrawer>
    </DrawerCloseContext.Provider>
  );
}

type DrawerCloseProps = React.ComponentPropsWithoutRef<"button">;

export function DrawerClose({ className, children, onClick, type = "button", ...props }: DrawerCloseProps) {
  const close = React.useContext(DrawerCloseContext);
  return (
    <button
      type={type}
      {...props}
      className={className}
      onClick={(e) => {
        close?.();
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
