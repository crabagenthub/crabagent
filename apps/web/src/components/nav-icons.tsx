import {
  IconApps,
  IconBranch,
  IconFile,
  IconDashboard,
  IconDesktop,
  IconNotification,
  IconSettings,
} from "@arco-design/web-react/icon";
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

export function NavIconOverview(props: IconProps) {
  const { title, ...rest } = props;
  return <IconApps {...rest} aria-label={title} />;
}

export function NavIconTraces(props: IconProps) {
  const { title, ...rest } = props;
  return <IconBranch {...rest} aria-label={title} />;
}

export function NavIconLogs(props: IconProps) {
  const { title, ...rest } = props;
  return <IconFile {...rest} aria-label={title} />;
}

export function NavIconAnalytics(props: IconProps) {
  const { title, ...rest } = props;
  return <IconDashboard {...rest} aria-label={title} />;
}

export function NavIconMachines(props: IconProps) {
  const { title, ...rest } = props;
  return <IconDesktop {...rest} aria-label={title} />;
}

export function NavIconAlerts(props: IconProps) {
  const { title, ...rest } = props;
  return <IconNotification {...rest} aria-label={title} />;
}

export function NavIconSettings(props: IconProps) {
  const { title, ...rest } = props;
  return <IconSettings {...rest} aria-label={title} />;
}
