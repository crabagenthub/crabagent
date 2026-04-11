import {
  IconApps,
  IconBranch,
  IconCode,
  IconFile,
  IconDashboard,
  IconDesktop,
  IconNotification,
  IconSafe,
  IconSettings,
  IconThunderbolt,
  IconCheckCircle,
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

export function NavIconCommandExec(props: IconProps) {
  const { title, ...rest } = props;
  return <IconCode {...rest} aria-label={title} />;
}

export function NavIconResourceAudit(props: IconProps) {
  const { title, ...rest } = props;
  return <IconSafe {...rest} aria-label={title} />;
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

export function NavIconDataSecurity(props: IconProps) {
  const { title, ...rest } = props;
  return <IconSafe {...rest} aria-label={title} />;
}

export function NavIconSettings(props: IconProps) {
  const { title, ...rest } = props;
  return <IconSettings {...rest} aria-label={title} />;
}

export function NavIconMetrics(props: IconProps) {
  const { title, ...rest } = props;
  return <IconCheckCircle {...rest} aria-label={title} />;
}

export function NavIconOptimization(props: IconProps) {
  const { title, ...rest } = props;
  return <IconThunderbolt {...rest} aria-label={title} />;
}
