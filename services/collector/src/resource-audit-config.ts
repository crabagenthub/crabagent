import fs from "node:fs";
import path from "node:path";

export const RESOURCE_AUDIT_HINT_TYPES = [
  "pii_hint",
  "secret_hint",
  "credential_hint",
  "config_hint",
  "database_hint",
] as const;

export type ResourceAuditHintType = (typeof RESOURCE_AUDIT_HINT_TYPES)[number];

export type ResourceAuditConfig = {
  dangerousPathRules: {
    posixPrefixes: string[];
    windowsPrefixes: string[];
    windowsRegex: string[];
    caseInsensitive: boolean;
  };
  largeRead: {
    thresholdChars: number;
  };
  largeToolResult: {
    thresholdChars: number;
  };
  policyLink: {
    enabled: boolean;
    targetActions: string[];
    matchScope: "span" | "trace";
  };
  policyHintTypes: {
    enabledHintTypes: ResourceAuditHintType[];
    defaultHintType: ResourceAuditHintType | null;
    includeUnlabeledPolicyHit: boolean;
  };
  shellExec: {
    loopAlerts: {
      minRepeatCount: number;
      maxItems: number;
    };
    tokenRisks: {
      stdoutCharsThreshold: number;
      maxItems: number;
    };
    commandSemantics: {
      enabled: boolean;
      defaultPlatform: "unix" | "windows_cmd" | "powershell";
      platformDetect: {
        preferSpanNameHints: boolean;
        spanNameHints: {
          unix: string[];
          windows_cmd: string[];
          powershell: string[];
        };
      };
      aliases: Record<string, string>;
      categories: {
        file: string[];
        network: string[];
        system: string[];
        process: string[];
        package: string[];
      };
      readLikeCommands: string[];
      diagnosticPatterns: {
        commandNotFound: string[];
        permissionDenied: string[];
        illegalArgHint: string[];
      };
    };
  };
};

const DEFAULT_CONFIG: ResourceAuditConfig = {
  dangerousPathRules: {
    posixPrefixes: ["/etc", "/root", "/var/lib", "/home", "~/.ssh", ".env", "private.key"],
    windowsPrefixes: [
      "c:\\users\\",
      "c:\\windows\\",
      "c:\\programdata\\",
      "%appdata%\\",
      "%userprofile%\\",
      "\\\\",
    ],
    windowsRegex: [
      "^[a-zA-Z]:\\\\\\\\Users\\\\\\\\[^\\\\\\\\]+\\\\\\\\\\.ssh\\\\\\\\",
      "\\\\\\\\[^\\\\\\\\]+\\\\\\\\[^\\\\\\\\]+",
      "^%APPDATA%\\\\\\\\",
      "^%USERPROFILE%\\\\\\\\",
    ],
    caseInsensitive: true,
  },
  largeRead: {
    thresholdChars: 500_000,
  },
  largeToolResult: {
    thresholdChars: 8_192,
  },
  policyLink: {
    enabled: true,
    targetActions: [],
    matchScope: "span",
  },
  policyHintTypes: {
    enabledHintTypes: [...RESOURCE_AUDIT_HINT_TYPES],
    defaultHintType: null,
    includeUnlabeledPolicyHit: false,
  },
  shellExec: {
    loopAlerts: {
      minRepeatCount: 3,
      maxItems: 20,
    },
    tokenRisks: {
      stdoutCharsThreshold: 24_000,
      maxItems: 15,
    },
    commandSemantics: {
      enabled: true,
      defaultPlatform: "unix",
      platformDetect: {
        preferSpanNameHints: true,
        spanNameHints: {
          unix: ["bash", "zsh", "sh", "terminal", "shell"],
          windows_cmd: ["cmd", "cmd.exe", "run_cmd", "runcmd"],
          powershell: ["pwsh", "powershell"],
        },
      },
      aliases: {
        ls: "get-childitem",
        dir: "get-childitem",
        gci: "get-childitem",
        cat: "get-content",
        type: "get-content",
        gc: "get-content",
        rm: "remove-item",
        del: "remove-item",
        erase: "remove-item",
        cp: "copy-item",
        copy: "copy-item",
        mv: "move-item",
        move: "move-item",
      },
      categories: {
        file: [
          "ls", "cat", "head", "tail", "less", "more", "find", "grep", "rg", "fd", "cp", "mv", "rm", "mkdir", "rmdir",
          "touch", "chmod", "chown", "stat", "diff", "wc", "sort", "uniq", "tee", "xargs", "sed", "awk", "readlink",
          "realpath", "tree", "dir", "type", "copy", "move", "del", "erase", "findstr", "where",
          "get-childitem", "get-content", "set-content", "copy-item", "move-item", "remove-item", "select-string",
        ],
        network: ["curl", "wget", "ping", "ssh", "scp", "rsync", "nc", "netcat", "telnet", "dig", "nslookup", "invoke-webrequest", "irm"],
        system: ["sudo", "su", "systemctl", "service", "mount", "umount", "df", "du", "free", "uname", "whoami", "id", "env", "printenv", "export", "ulimit", "sysctl", "setx"],
        process: ["ps", "top", "htop", "kill", "killall", "pkill", "pgrep", "jobs", "fg", "bg", "nohup", "nice", "tasklist", "taskkill", "get-process", "stop-process"],
        package: ["npm", "pnpm", "yarn", "bun", "pip", "pip3", "apt", "apt-get", "yum", "dnf", "brew", "cargo", "go", "choco", "winget"],
      },
      readLikeCommands: ["cat", "head", "tail", "less", "grep", "rg", "find", "type", "findstr", "get-content", "select-string"],
      diagnosticPatterns: {
        commandNotFound: ["command not found", "not found as command", "is not recognized as an internal or external command"],
        permissionDenied: ["permission denied", "access is denied", "operation not permitted", "eacces"],
        illegalArgHint: ["illegal option", "invalid option", "unrecognized option", "syntax error", "usage:", "parameter cannot be found"],
      },
    },
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
}

function cleanHintTypes(v: unknown): ResourceAuditHintType[] {
  const set = new Set<ResourceAuditHintType>();
  for (const x of cleanStringArray(v)) {
    if ((RESOURCE_AUDIT_HINT_TYPES as readonly string[]).includes(x)) {
      set.add(x as ResourceAuditHintType);
    }
  }
  return [...set];
}

function cleanStringMap(v: unknown): Record<string, string> {
  if (!isRecord(v)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    const key = String(k ?? "").trim().toLowerCase();
    const next = String(val ?? "").trim().toLowerCase();
    if (!key || !next) {
      continue;
    }
    out[key] = next;
  }
  return out;
}

export function defaultResourceAuditConfig(): ResourceAuditConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ResourceAuditConfig;
}

export function normalizeResourceAuditConfig(raw: unknown): ResourceAuditConfig {
  const base = defaultResourceAuditConfig();
  if (!isRecord(raw)) {
    return base;
  }
  const dangerous = isRecord(raw.dangerousPathRules) ? raw.dangerousPathRules : {};
  const largeRead = isRecord(raw.largeRead) ? raw.largeRead : {};
  const largeToolResult = isRecord(raw.largeToolResult) ? raw.largeToolResult : {};
  const policyLink = isRecord(raw.policyLink) ? raw.policyLink : {};
  const policyHintTypes = isRecord(raw.policyHintTypes) ? raw.policyHintTypes : {};
  const shellExec = isRecord(raw.shellExec) ? raw.shellExec : {};
  const shellLoopAlerts = isRecord(shellExec.loopAlerts) ? shellExec.loopAlerts : {};
  const shellTokenRisks = isRecord(shellExec.tokenRisks) ? shellExec.tokenRisks : {};
  const commandSemantics = isRecord(shellExec.commandSemantics) ? shellExec.commandSemantics : {};
  const platformDetect = isRecord(commandSemantics.platformDetect) ? commandSemantics.platformDetect : {};
  const spanNameHints = isRecord(platformDetect.spanNameHints) ? platformDetect.spanNameHints : {};
  const categories = isRecord(commandSemantics.categories) ? commandSemantics.categories : {};
  const diagnosticPatterns = isRecord(commandSemantics.diagnosticPatterns) ? commandSemantics.diagnosticPatterns : {};

  const next: ResourceAuditConfig = {
    dangerousPathRules: {
      posixPrefixes: cleanStringArray(dangerous.posixPrefixes),
      windowsPrefixes: cleanStringArray(dangerous.windowsPrefixes),
      windowsRegex: cleanStringArray(dangerous.windowsRegex),
      caseInsensitive:
        typeof dangerous.caseInsensitive === "boolean"
          ? dangerous.caseInsensitive
          : base.dangerousPathRules.caseInsensitive,
    },
    largeRead: {
      thresholdChars:
        Number.isFinite(Number(largeRead.thresholdChars)) && Number(largeRead.thresholdChars) >= 0
          ? Math.floor(Number(largeRead.thresholdChars))
          : base.largeRead.thresholdChars,
    },
    largeToolResult: {
      thresholdChars:
        Number.isFinite(Number(largeToolResult.thresholdChars)) && Number(largeToolResult.thresholdChars) >= 0
          ? Math.floor(Number(largeToolResult.thresholdChars))
          : base.largeToolResult.thresholdChars,
    },
    policyLink: {
      enabled: typeof policyLink.enabled === "boolean" ? policyLink.enabled : base.policyLink.enabled,
      targetActions: cleanStringArray(policyLink.targetActions),
      matchScope: policyLink.matchScope === "trace" ? "trace" : "span",
    },
    policyHintTypes: {
      enabledHintTypes: cleanHintTypes(policyHintTypes.enabledHintTypes),
      defaultHintType:
        typeof policyHintTypes.defaultHintType === "string" &&
        (RESOURCE_AUDIT_HINT_TYPES as readonly string[]).includes(policyHintTypes.defaultHintType)
          ? (policyHintTypes.defaultHintType as ResourceAuditHintType)
          : null,
      includeUnlabeledPolicyHit:
        typeof policyHintTypes.includeUnlabeledPolicyHit === "boolean"
          ? policyHintTypes.includeUnlabeledPolicyHit
          : base.policyHintTypes.includeUnlabeledPolicyHit,
    },
    shellExec: {
      loopAlerts: {
        minRepeatCount:
          Number.isFinite(Number(shellLoopAlerts.minRepeatCount)) && Number(shellLoopAlerts.minRepeatCount) >= 1
            ? Math.floor(Number(shellLoopAlerts.minRepeatCount))
            : base.shellExec.loopAlerts.minRepeatCount,
        maxItems:
          Number.isFinite(Number(shellLoopAlerts.maxItems)) && Number(shellLoopAlerts.maxItems) >= 1
            ? Math.floor(Number(shellLoopAlerts.maxItems))
            : base.shellExec.loopAlerts.maxItems,
      },
      tokenRisks: {
        stdoutCharsThreshold:
          Number.isFinite(Number(shellTokenRisks.stdoutCharsThreshold)) &&
          Number(shellTokenRisks.stdoutCharsThreshold) >= 0
            ? Math.floor(Number(shellTokenRisks.stdoutCharsThreshold))
            : base.shellExec.tokenRisks.stdoutCharsThreshold,
        maxItems:
          Number.isFinite(Number(shellTokenRisks.maxItems)) && Number(shellTokenRisks.maxItems) >= 1
            ? Math.floor(Number(shellTokenRisks.maxItems))
            : base.shellExec.tokenRisks.maxItems,
      },
      commandSemantics: {
        enabled:
          typeof commandSemantics.enabled === "boolean"
            ? commandSemantics.enabled
            : base.shellExec.commandSemantics.enabled,
        defaultPlatform:
          commandSemantics.defaultPlatform === "windows_cmd" || commandSemantics.defaultPlatform === "powershell"
            ? commandSemantics.defaultPlatform
            : "unix",
        platformDetect: {
          preferSpanNameHints:
            typeof platformDetect.preferSpanNameHints === "boolean"
              ? platformDetect.preferSpanNameHints
              : base.shellExec.commandSemantics.platformDetect.preferSpanNameHints,
          spanNameHints: {
            unix: cleanStringArray(spanNameHints.unix),
            windows_cmd: cleanStringArray(spanNameHints.windows_cmd),
            powershell: cleanStringArray(spanNameHints.powershell),
          },
        },
        aliases: cleanStringMap(commandSemantics.aliases),
        categories: {
          file: cleanStringArray(categories.file),
          network: cleanStringArray(categories.network),
          system: cleanStringArray(categories.system),
          process: cleanStringArray(categories.process),
          package: cleanStringArray(categories.package),
        },
        readLikeCommands: cleanStringArray(commandSemantics.readLikeCommands),
        diagnosticPatterns: {
          commandNotFound: cleanStringArray(diagnosticPatterns.commandNotFound),
          permissionDenied: cleanStringArray(diagnosticPatterns.permissionDenied),
          illegalArgHint: cleanStringArray(diagnosticPatterns.illegalArgHint),
        },
      },
    },
  };
  if (Object.keys(next.shellExec.commandSemantics.aliases).length === 0) {
    next.shellExec.commandSemantics.aliases = { ...base.shellExec.commandSemantics.aliases };
  }
  if (next.shellExec.commandSemantics.categories.file.length === 0) {
    next.shellExec.commandSemantics.categories = JSON.parse(
      JSON.stringify(base.shellExec.commandSemantics.categories),
    ) as ResourceAuditConfig["shellExec"]["commandSemantics"]["categories"];
  }
  if (next.shellExec.commandSemantics.readLikeCommands.length === 0) {
    next.shellExec.commandSemantics.readLikeCommands = [
      ...base.shellExec.commandSemantics.readLikeCommands,
    ];
  }
  if (next.policyHintTypes.enabledHintTypes.length === 0) {
    next.policyHintTypes.enabledHintTypes = [...base.policyHintTypes.enabledHintTypes];
  }
  for (const pat of next.dangerousPathRules.windowsRegex) {
    // Validate regex eagerly to reject bad config writes.
    new RegExp(pat);
  }
  return next;
}

function resolveResourceAuditConfigPath(): string {
  const raw = process.env.CRABAGENT_RESOURCE_AUDIT_CONFIG?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  return path.resolve(process.cwd(), "resource-audit.config.json");
}

let cachedPath = "";
let cachedMtimeMs = -1;
let cachedConfig: ResourceAuditConfig | null = null;

export function loadResourceAuditConfig(): ResourceAuditConfig {
  const configPath = resolveResourceAuditConfigPath();
  try {
    const st = fs.statSync(configPath);
    const nextMtimeMs = Number(st.mtimeMs) || 0;
    if (cachedConfig && cachedPath === configPath && nextMtimeMs === cachedMtimeMs) {
      return JSON.parse(JSON.stringify(cachedConfig)) as ResourceAuditConfig;
    }
    const text = fs.readFileSync(configPath, "utf8");
    const normalized = normalizeResourceAuditConfig(JSON.parse(text));
    cachedPath = configPath;
    cachedMtimeMs = nextMtimeMs;
    cachedConfig = normalized;
    return JSON.parse(JSON.stringify(normalized)) as ResourceAuditConfig;
  } catch {
    return defaultResourceAuditConfig();
  }
}
