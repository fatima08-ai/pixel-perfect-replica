/**
 * All network calls for RAGScript live here.
 * Backend contract (base URL configurable, default http://localhost:8000):
 *   POST /index   body { files: [{ path, content }] }        -> { files, chunks }
 *   POST /query   body { query, top_k, model }               -> JSON { answer, sources }
 *                 or a text stream with sources JSON in the `X-Sources` header
 *   GET  /status                                             -> { status, files, chunks }
 * The Groq API key lives only in the backend .env — never in this frontend.
 */
import { countChunks } from "./files";
import { composeAnswer, retrieve, streamText } from "./mock";
import type { CodeFile, IndexInfo, Settings, Source } from "./types";

export class BackendUnreachableError extends Error {}

const TIMEOUT_MS = 8000;

async function request(base: string, path: string, init?: RequestInit, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Backend returned ${res.status} ${res.statusText}`);
    return res;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof TypeError || (e as Error).name === "AbortError")
      throw new BackendUnreachableError(`Can't reach the backend at ${base}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiOptions {
  settings: Settings;
  files: CodeFile[];
}

export interface IndexResult {
  files: number;
  chunks: number;
  usedDemo: boolean;
}

export async function indexCodebase(files: CodeFile[], { settings }: Pick<ApiOptions, "settings">): Promise<IndexResult> {
  const local = { files: files.length, chunks: countChunks(files) };
  if (settings.demoMode) return { ...local, usedDemo: true };
  try {
    const res = await request(settings.apiBaseUrl, "/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files.map(({ path, content }) => ({ path, content })) }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<IndexResult>;
    return { files: data.files ?? local.files, chunks: data.chunks ?? local.chunks, usedDemo: false };
  } catch (e) {
    if (e instanceof BackendUnreachableError) return { ...local, usedDemo: true };
    throw e;
  }
}

export interface AskResult {
  sources: Source[];
  stream: AsyncGenerator<string>;
  usedDemo: boolean;
}

export async function askQuestion(
  query: string,
  { settings, files, signal }: ApiOptions & { signal?: AbortSignal },
): Promise<AskResult> {
  const demo = (): AskResult => {
    const sources = retrieve(query, files, settings.topK);
    return { sources, stream: streamText(composeAnswer(query, sources, files), signal), usedDemo: true };
  };
  if (settings.demoMode) return demo();
  try {
    const res = await request(
      settings.apiBaseUrl,
      "/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: settings.topK, model: settings.model }),
      },
      signal,
    );
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const data = (await res.json()) as { answer?: string; sources?: Source[] };
      return { sources: data.sources ?? [], stream: streamText(data.answer ?? "", signal), usedDemo: false };
    }
    let sources: Source[] = [];
    try {
      sources = JSON.parse(res.headers.get("x-sources") ?? "[]");
    } catch {
      sources = [];
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    async function* gen() {
      while (true) {
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;
        yield decoder.decode(value, { stream: true });
      }
    }
    return { sources, stream: gen(), usedDemo: false };
  } catch (e) {
    if (e instanceof BackendUnreachableError) return demo();
    throw e;
  }
}

export async function getIndexStatus({ settings, files }: ApiOptions): Promise<IndexInfo & { usedDemo: boolean }> {
  const local: IndexInfo = {
    status: files.length ? "ready" : "not_indexed",
    files: files.length,
    chunks: countChunks(files),
  };
  if (settings.demoMode) return { ...local, usedDemo: true };
  try {
    const res = await request(settings.apiBaseUrl, "/status");
    const data = (await res.json()) as Partial<IndexInfo>;
    return { ...local, ...data, usedDemo: false };
  } catch {
    return { ...local, usedDemo: true };
  }
}
