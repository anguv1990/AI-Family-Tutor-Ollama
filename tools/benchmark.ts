/**
 * Day 27 — local model benchmark and registry.
 *
 * Measures the two latency budgets in `plan.md` acceptance criterion 9 on the
 * machine that will actually run the tutor:
 *
 *   - deterministic path: answer submitted -> next question in hand, <= 2000ms
 *   - hint path:          question -> validated child-safe hint,    <= 5000ms
 *
 * It runs against an in-memory database and a synthetic learner, so no child
 * data is read or written and the output is safe to commit. Cold latency is
 * the first call after the model is unloaded; warm latency is every call
 * after. Both matter: a four-year-old meets the cold one.
 *
 * Usage:  npm run benchmark            (uses FLASH_MODEL or qwen2.5:7b)
 *         FLASH_MODEL=... npm run benchmark
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { AiGateway, HintService, OllamaProvider, MemoryCacheStore, MemorySafetyEventSink } from '../server/ai';

const DETERMINISTIC_BUDGET_MS = 2000;
const HINT_BUDGET_MS = 5000;
const HINT_SAMPLES = 8;

const MODEL = process.env.FLASH_MODEL ?? 'qwen2.5:7b';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

type Sample = { ms: number; ok: boolean; detail?: string };

type Summary = {
  count: number;
  failures: number;
  failureRate: number;
  coldMs: number | null;
  warmMedianMs: number | null;
  warmP95Ms: number | null;
  warmMaxMs: number | null;
};

function summarise(samples: Sample[]): Summary {
  const ok = samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  // The first successful call is the cold one; percentiles are taken from the
  // rest, because mixing them hides both numbers.
  const [cold, ...warm] = ok;
  const sorted = [...warm].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];

  return {
    count: samples.length,
    failures: samples.filter((sample) => !sample.ok).length,
    failureRate: samples.length === 0 ? 0 : samples.filter((sample) => !sample.ok).length / samples.length,
    coldMs: cold ?? null,
    warmMedianMs: at(0.5),
    warmP95Ms: at(0.95),
    warmMaxMs: sorted.length === 0 ? null : sorted[sorted.length - 1],
  };
}

async function time(run: () => Promise<unknown> | unknown): Promise<Sample> {
  const started = process.hrtime.bigint();
  try {
    await run();
    return { ms: Number(process.hrtime.bigint() - started) / 1e6, ok: true };
  } catch (error) {
    return {
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      ok: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/** Model provenance straight from Ollama, so the registry cannot drift from reality. */
function modelProvenance(model: string): Record<string, string> {
  const provenance: Record<string, string> = { model };
  try {
    const shown = execFileSync('ollama', ['show', model], { encoding: 'utf8', timeout: 20000 });
    for (const [key, pattern] of [
      ['parameters', /parameters\s+([\dBM.]+)/i],
      ['quantization', /quantization\s+(\S+)/i],
      ['architecture', /architecture\s+(\S+)/i],
      ['contextLength', /context length\s+(\S+)/i],
    ] as const) {
      const match = shown.match(pattern);
      if (match) provenance[key] = match[1];
    }
    const listed = execFileSync('ollama', ['list'], { encoding: 'utf8', timeout: 20000 })
      .split('\n')
      .find((line) => line.startsWith(model));
    if (listed) {
      const columns = listed.split(/\s{2,}/);
      if (columns[1]) provenance.digest = columns[1].trim();
      if (columns[2]) provenance.size = columns[2].trim();
    }
  } catch (error) {
    provenance.provenanceError = error instanceof Error ? error.message : 'ollama not reachable';
  }
  return provenance;
}

async function benchmarkDeterministicPath(): Promise<Sample[]> {
  // In-memory: the benchmark must never touch the family database.
  const database = createDatabase(':memory:');
  const tutor = new TutoringService(database);
  tutor.seedInitialContent();

  const samples: Sample[] = [];
  const started = tutor.startSession({ childId: 'benchmark-synthetic-learner' });
  const sessionId = started.sessionId;
  if (!sessionId) throw new Error('no session was available to benchmark');
  let question: { id: string; prompt: string } | null = started.question;

  // Deliberately answers wrongly: it keeps mastery low and the session running
  // long enough to sample, and marking cost does not depend on correctness.
  while (question) {
    const current = question;
    let next: { id: string; prompt: string } | null = null;
    samples.push(
      await time(() => {
        const result = tutor.submitAnswer({
          sessionId,
          questionId: current.id,
          answer: '999',
        });
        next = result.nextQuestion;
      }),
    );
    question = next;
    if (samples.length >= 20) break;
  }

  database.close();
  return samples;
}

async function benchmarkHintPath(): Promise<{ samples: Sample[]; fallbacks: number }> {
  const gateway = new AiGateway({
    routes: {
      'local-fast': {
        providerId: 'ollama',
        model: MODEL,
        provider: new OllamaProvider({ baseUrl: OLLAMA_URL, model: MODEL, timeoutMs: HINT_BUDGET_MS }),
      },
    },
    // No cache: a cached hint measures SQLite, not the model.
    cache: undefined,
    events: new MemorySafetyEventSink(),
  });
  const hints = new HintService(gateway);

  const questions = [
    { prompt: 'What is 2 add 1?', answer: '3', difficulty: 1 },
    { prompt: 'What is 3 add 2?', answer: '5', difficulty: 2 },
    { prompt: 'How many are 4 and 1 together?', answer: '5', difficulty: 2 },
    { prompt: 'Count the apples: 6 apples. How many?', answer: '6', difficulty: 1 },
  ];

  const samples: Sample[] = [];
  let fallbacks = 0;

  for (let index = 0; index < HINT_SAMPLES; index += 1) {
    const question = questions[index % questions.length];
    samples.push(
      await time(async () => {
        const result = await hints.getHint({
          questionPrompt: question.prompt,
          skillId: 'reception.addition-within-5',
          difficulty: question.difficulty,
          correctAnswer: question.answer,
        });
        // A fallback is a successful *request* but a failed model call, and
        // the distinction is the whole point of the failure-rate column.
        if (result.source === 'fallback') fallbacks += 1;
      }),
    );
  }

  return { samples, fallbacks };
}

function verdict(summary: Summary, budgetMs: number): { pass: boolean; line: string } {
  const measured = summary.warmP95Ms ?? summary.coldMs;
  if (measured === null) return { pass: false, line: 'no successful samples' };
  const pass = measured <= budgetMs;
  return {
    pass,
    line: `${pass ? 'PASS' : 'FAIL'} — p95 ${measured.toFixed(0)}ms against a ${budgetMs}ms budget`,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const memoryBefore = process.memoryUsage().rss;

  console.log(`Benchmarking ${MODEL} at ${OLLAMA_URL}\n`);

  const deterministic = summarise(await benchmarkDeterministicPath());
  console.log('deterministic path sampled');

  const hintRun = await benchmarkHintPath();
  const hint = summarise(hintRun.samples);
  console.log('hint path sampled\n');

  const memoryAfter = process.memoryUsage().rss;
  const deterministicVerdict = verdict(deterministic, DETERMINISTIC_BUDGET_MS);
  const hintVerdict = verdict(hint, HINT_BUDGET_MS);

  const report = {
    startedAt,
    model: modelProvenance(MODEL),
    options: { temperature: 0.2, maxOutputTokens: 60, promptVersion: 'hint.2026-08-11.v1' },
    hardware: {
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      totalMemoryGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      nodeVersion: process.version,
    },
    deterministicPath: { ...deterministic, budgetMs: DETERMINISTIC_BUDGET_MS, verdict: deterministicVerdict.line },
    hintPath: {
      ...hint,
      fallbacks: hintRun.fallbacks,
      budgetMs: HINT_BUDGET_MS,
      verdict: hintVerdict.line,
    },
    processMemoryMb: {
      before: Number((memoryBefore / 1024 ** 2).toFixed(1)),
      after: Number((memoryAfter / 1024 ** 2).toFixed(1)),
    },
    decision: deterministicVerdict.pass && hintVerdict.pass ? 'accept' : 'reject',
  };

  console.log(`deterministic: ${deterministicVerdict.line}`);
  console.log(`hint:          ${hintVerdict.line}`);
  console.log(`hint fallbacks: ${hintRun.fallbacks}/${hint.count}`);
  console.log(`\ndecision: ${report.decision.toUpperCase()}`);

  const outputPath = path.resolve(process.cwd(), 'docs/model-registry.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nregistry written to ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
