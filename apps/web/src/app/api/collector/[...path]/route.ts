import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** 服务端转发目标；与 Collector 默认端口一致。 */
function targetBase(): string {
  const raw =
    process.env.COLLECTOR_PROXY_TARGET?.trim() ||
    process.env.COLLECTOR_INTERNAL_URL?.trim() ||
    "http://127.0.0.1:8787";
  return raw.replace(/\/+$/, "");
}

function isAllowedSubpath(sub: string): boolean {
  return sub === "health" || sub.startsWith("v1/");
}

/**
 * 浏览器同源访问 Collector（避免 localhost:3000 → 127.0.0.1:8787 的跨域 / Private Network Access 问题）。
 * 仅允许 `health` 与 `v1/*`。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = (path ?? []).join("/");
  if (!sub || !isAllowedSubpath(sub)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  const destUrl = new URL(req.url);
  const target = `${targetBase()}/${sub}${destUrl.search}`;
  const headers = new Headers();
  const ak = req.headers.get("x-api-key");
  if (ak) {
    headers.set("x-api-key", ak);
  }
  const auth = req.headers.get("authorization");
  if (auth) {
    headers.set("authorization", auth);
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, cache: "no-store" });
  } catch (e) {
    return NextResponse.json(
      { error: "collector_unreachable", message: String(e) },
      { status: 502 },
    );
  }
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": ct },
  });
}
