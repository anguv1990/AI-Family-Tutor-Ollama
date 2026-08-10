const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS) || 15000;
const DEFAULT_RETRIES = Number(process.env.OLLAMA_RETRIES) || 2;

export interface GenerateOptions {
  max_tokens?: number;
  temperature?: number;
  [key: string]: any;
}

function timeoutFetch(url: string, init: any, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function doRequest(body: any, timeoutMs: number) {
  const res = await timeoutFetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error: ${res.status} ${text}`);
  }

  const data = await res.json().catch(() => null);
  return data;
}

export async function generate(model: string, prompt: string, opts: GenerateOptions = {}) {
  if (!model) throw new Error('generate: model is required');
  const body = {
    model,
    prompt,
    ...opts,
  };

  const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT);
  const retries = Number(opts.retries ?? DEFAULT_RETRIES);

  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await doRequest(body, timeoutMs);
      // Normalize response: prefer { text } or raw data for consumers
      if (!data) throw new Error('Ollama returned empty response');

      // Ollama responses may be { "output": "..." } or more structured; attempt normalization
      if (typeof data === 'string') return { text: data, raw: data };
      if (data.output && typeof data.output === 'string') return { text: data.output, raw: data };
      if (Array.isArray(data.results) && data.results.length > 0 && data.results[0].content) {
        return { text: data.results[0].content, raw: data };
      }

      // Fallback: return the whole payload as raw
      return { text: JSON.stringify(data), raw: data };
    } catch (err: any) {
      lastErr = err;
      // Abort early on non-retryable errors
      if (err.name === 'AbortError') lastErr = new Error('Ollama request timed out');
      if (attempt < retries) {
        // exponential backoff
        const backoff = 200 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr;
}
