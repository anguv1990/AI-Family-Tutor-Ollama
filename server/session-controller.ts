import { generate } from './model-adapter';
import { promptHash, getCached, setCached } from './cache';

export async function generateQuestion(model: string, prompt: string, opts = {}) {
  const hash = promptHash(model, prompt, opts);
  const cached = getCached(hash);
  if (cached) return cached;

  const out = await generate(model, prompt, opts);
  setCached(hash, out);
  return out;
}

// TODO: add session persistence, mastery updates, and evaluation helpers
