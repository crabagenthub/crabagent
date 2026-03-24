import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

const base = "shrink-0";

export function NavIconOverview(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <rect x="3" y="3" width="8" height="8" rx="1.25" />
      <rect x="13" y="3" width="8" height="8" rx="1.25" />
      <rect x="3" y="13" width="8" height="8" rx="1.25" />
      <rect x="13" y="13" width="8" height="8" rx="1.25" />
    </svg>
  );
}

export function NavIconTraces(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="18" cy="10" r="2.25" />
      <circle cx="10" cy="18" r="2.25" />
      <path d="M7.6 7.4 8.7 16.3M16.2 11.4 11.8 16.6" />
    </svg>
  );
}

export function NavIconLogs(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M8 4h10a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function NavIconAnalytics(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M4 19V5M4 19h16M8 19v-5M12 19V9M16 19v-3" />
    </svg>
  );
}

export function NavIconMachines(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <rect x="4" y="4" width="16" height="6" rx="1.25" />
      <rect x="4" y="14" width="16" height="6" rx="1.25" />
      <path d="M8 8h.01M8 18h.01M16 8h.01M16 18h.01" />
    </svg>
  );
}

export function NavIconAlerts(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
      <path d="M10.29 20.5a2.5 2.5 0 0 0 3.42 0" />
    </svg>
  );
}

export function NavIconSettings(props: IconProps) {
  const { className, title, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[base, className].filter(Boolean).join(" ")}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
