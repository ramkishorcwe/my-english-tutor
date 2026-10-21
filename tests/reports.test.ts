import { describe, expect, it, vi } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { generateReport } from '../src/lib/reports';
import { demoReport, demoTurns } from '../src/lib/data';

const response = (report: unknown) => ({ text: JSON.stringify(report) }) as GenerateContentResponse;
const failure = (status: number) =>
  Object.assign(new Error('provider error with private details'), { status });
const pause = async () => {};

describe('summary generation recovery', () => {
  it('retries high demand and uses the backup model, returning grounded corrections', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(failure(503))
      .mockRejectedValueOnce(failure(503))
      .mockResolvedValue(response(demoReport));
    expect(
      await generateReport('Cafe', demoTurns, {
        model: 'primary',
        fallbackModel: 'backup',
        generate,
        pause,
      }),
    ).toEqual(demoReport);
    expect(generate.mock.calls.map(([params]) => params.model)).toEqual([
      'primary',
      'backup',
      'backup',
    ]);
    expect(generate.mock.calls[0][0].config.httpOptions).toEqual({
      timeout: 25000,
      retryOptions: { attempts: 1 },
    });
  });
  it('constrains model references to short learner IDs and saves original transcript IDs', async () => {
    const output = structuredClone(demoReport);
    for (const item of [
      ...output.grammar,
      ...output.expressions,
      ...output.vocabulary,
      ...output.exercises,
    ])
      item.turnId = `turn_${demoTurns.findIndex((turn) => turn.id === item.turnId) + 1}`;
    const generate = vi.fn().mockResolvedValue(response(output));
    expect(await generateReport('Cafe', demoTurns, { model: 'primary', generate, pause })).toEqual(
      demoReport,
    );
    const input = JSON.parse(generate.mock.calls[0][0].contents);
    expect(input.turns[1].id).toBe('turn_2');
    expect(JSON.stringify(input)).not.toContain(demoTurns[1].id);
  });
  it('repairs ungrounded quotes before returning a report', async () => {
    const invalid = structuredClone(demoReport);
    invalid.grammar[0].original = 'An invented learner sentence';
    const generate = vi
      .fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(demoReport));
    const report = await generateReport('Cafe', demoTurns, { model: 'primary', generate, pause });
    expect(report.grammar[0].original).toBe(demoReport.grammar[0].original);
    expect(generate.mock.calls[1][0].config.systemInstruction).toContain('failed validation');
  });
  it('never returns malformed or unverified model output as a successful summary', async () => {
    const invalid = structuredClone(demoReport);
    invalid.vocabulary[0].turnId = demoTurns[0].id;
    const generate = vi.fn().mockResolvedValue(response(invalid));
    await expect(
      generateReport('Cafe', demoTurns, { model: 'primary', generate, pause }),
    ).rejects.toThrow('could not be verified');
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it('gives an actionable quota error without leaking provider messages or repeatedly spending requests', async () => {
    const generate = vi.fn().mockRejectedValue(failure(429));
    await expect(
      generateReport('Cafe', demoTurns, { model: 'primary', generate, pause }),
    ).rejects.toMatchObject({ status: 429, message: expect.stringContaining('usage limit') });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('does not send an empty learner transcript to the model', async () => {
    const generate = vi.fn();
    await expect(
      generateReport('Cafe', [demoTurns[0]], { model: 'primary', generate, pause }),
    ).rejects.toMatchObject({ status: 422 });
    expect(generate).not.toHaveBeenCalled();
  });
  it('switches straight to the backup for a removed primary model', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(failure(404))
      .mockResolvedValue(response(demoReport));
    await generateReport('Cafe', demoTurns, {
      model: 'primary',
      fallbackModel: 'backup',
      generate,
      pause,
    });
    expect(generate.mock.calls.map(([params]) => params.model)).toEqual(['primary', 'backup']);
  });
});
