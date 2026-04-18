/**
 * iseeagentc（Go）JSON 成功体一律为信封：`{ code, message, request_id, result }`，业务数据在 `result`。
 * `/health` 与其它 JSON API 均用 {@link readCollectorHealthResult} / {@link readCollectorFetchResult} 解包。
 */

function isCollectorEnvelope(o: Record<string, unknown>): boolean {
  return (
    "result" in o &&
    (typeof o.code === "number" || typeof o.request_id === "string")
  );
}

/** 网关可能固定 HTTP 200，在信封里用 `code` 表示业务失败（与 HTTP 语义对齐）。 */
function envelopeIndicatesHttpStyleFailure(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const o = raw as Record<string, unknown>;
  if (!isCollectorEnvelope(o)) {
    return false;
  }
  const c = o.code;
  return typeof c === "number" && c >= 400;
}

/**
 * 从原始 JSON 解出 `result`。仅接受 Go 信封；顶层直出 JSON 会抛错。
 */
export function unwrapCollectorResult(raw: unknown): unknown {
  if (raw == null) {
    return raw;
  }
  if (Array.isArray(raw) || typeof raw !== "object") {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  if (!isCollectorEnvelope(o)) {
    throw new Error("collector: expected Go API envelope { code, request_id, result }");
  }
  return o.result;
}

/** 从已解析的 JSON 得到业务体（用于非 `Response` 场景）。 */
export function parseCollectorBody<T>(raw: unknown): T {
  return unwrapCollectorResult(raw) as T;
}

/**
 * 成功 HTTP 后 `result` 应为 object 或（少数接口）array；`null`/原始值会导致下游读 `j.items` 抛错。
 */
function normalizeFetchedBusinessBody(parsed: unknown): unknown {
  if (parsed == null) {
    return {};
  }
  if (typeof parsed !== "object") {
    return {};
  }
  return parsed;
}

/** `items` 非数组时避免 `(x.items ?? []).map` 把非数组当数组用而抛错。 */
export function collectorItemsArray<T = unknown>(items: unknown): T[] {
  return Array.isArray(items) ? (items as T[]) : [];
}

/** 读取 `fetch` 的 JSON 并解包为业务体（不校验 HTTP 状态；成功/失败场景请优先用 {@link readCollectorFetchResult}）。 */
export async function readCollectorJson<T>(res: Response): Promise<T> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }
  return unwrapCollectorResult(raw) as T;
}

/**
 * 单次 `res.json()`：非成功 HTTP 时抛出（优先 {@link collectorErrorMessage}），成功则解包为业务体。
 * @param fallbackMessage 服务端无 `message`/`error` 时的兜底文案（可带操作语义）。
 */
export async function readCollectorFetchResult<T>(
  res: Response,
  fallbackMessage?: string,
): Promise<T> {
  const rawBody = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(collectorErrorMessage(rawBody) || fallbackMessage || `HTTP ${res.status}`);
  }
  if (envelopeIndicatesHttpStyleFailure(rawBody)) {
    const c =
      rawBody != null && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>).code
        : undefined;
    throw new Error(
      collectorErrorMessage(rawBody) ||
        fallbackMessage ||
        (typeof c === "number" ? `HTTP ${c}` : "Request failed"),
    );
  }
  const unwrapped = parseCollectorBody<unknown>(rawBody);
  const normalized = normalizeFetchedBusinessBody(unwrapped);
  return normalized as T;
}

/**
 * `/health` 与 Collector JSON 一致：成功响应须为 Go 信封，解包 `result`。
 * HTTP 错误与「HTTP 200 + 信封 code>=400」语义与 {@link readCollectorFetchResult} 一致。
 */
export async function readCollectorHealthResult<T = unknown>(
  res: Response,
  fallbackMessage?: string,
): Promise<T> {
  const rawBody = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(collectorErrorMessage(rawBody) || fallbackMessage || `HTTP ${res.status}`);
  }
  if (envelopeIndicatesHttpStyleFailure(rawBody)) {
    const c =
      rawBody != null && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>).code
        : undefined;
    throw new Error(
      collectorErrorMessage(rawBody) ||
        fallbackMessage ||
        (typeof c === "number" ? `HTTP ${c}` : "Request failed"),
    );
  }
  const inner = unwrapCollectorResult(rawBody);
  return normalizeFetchedBusinessBody(inner) as T;
}

/**
 * 从失败或成功响应中提取可读错误文案（信封顶层、Go `AbortWithWriteErrorResponse` 的 `message.global`、旧式 `error` 字符串等）。
 */
export function collectorErrorMessage(raw: unknown): string {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return "";
  }
  const top = raw as Record<string, unknown>;
  if (typeof top.message === "string" && top.message.trim()) {
    return top.message.trim();
  }
  const nestedMsg = top.message;
  if (nestedMsg != null && typeof nestedMsg === "object" && !Array.isArray(nestedMsg)) {
    const glob = (nestedMsg as Record<string, unknown>).global;
    if (typeof glob === "string" && glob.trim()) {
      return glob.trim();
    }
  }
  if (typeof top.error === "string" && top.error.trim()) {
    return top.error.trim();
  }
  let inner: unknown;
  try {
    inner = unwrapCollectorResult(raw);
  } catch {
    return "";
  }
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
    const io = inner as Record<string, unknown>;
    if (typeof io.error === "string" && io.error.trim()) {
      return io.error.trim();
    }
    if (typeof io.message === "string" && io.message.trim()) {
      return io.message.trim();
    }
  }
  return "";
}
