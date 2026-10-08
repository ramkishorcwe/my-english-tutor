import { describe, it, expect } from 'vitest';
import { reportSchema, validateEvidence, profileSchema, sessionSchema } from '../src/lib/schema';
import { demoReport, demoTurns } from '../src/lib/data';
describe('Report evidence', () => {
  it('accepts a report with exact learner quotes', () => {
    expect(validateEvidence(reportSchema.parse(demoReport), demoTurns)).toEqual(demoReport);
  });
  it('rejects a fabricated correction quote', () => {
    const report = structuredClone(demoReport);
    report.grammar[0].original = 'I has a coffee.';
    expect(() => validateEvidence(report, demoTurns)).toThrow('ungrounded');
  });
  it('rejects a coach quote presented as a learner quote', () => {
    const report = structuredClone(demoReport);
    report.grammar[0].original = demoTurns[0].text;
    report.grammar[0].turnId = demoTurns[0].id;
    expect(() => validateEvidence(report, demoTurns)).toThrow('ungrounded');
  });
  it('rejects unknown exercise references', () => {
    const report = structuredClone(demoReport);
    report.exercises[0].turnId = 'invented';
    expect(() => validateEvidence(report, demoTurns)).toThrow('transcript reference');
  });
  it('rejects optional expressions with altered quotes', () => {
    const report = structuredClone(demoReport);
    report.expressions[0].original = 'amazing coffee';
    expect(() => validateEvidence(report, demoTurns)).toThrow('ungrounded');
  });
  it('rejects invalid provider output before rendering', () => {
    expect(reportSchema.safeParse({ ...demoReport, grammar: [{ original: 'a' }] }).success).toBe(
      false,
    );
  });
  it('enforces bounded session duration', () => {
    expect(
      sessionSchema.safeParse({
        topic: 'Travel',
        mode: 'Travel',
        duration: 90,
        difficulty: 'Comfortable',
        input_mode: 'hands-free',
      }).success,
    ).toBe(false);
  });
  it('requires a real profile name and bounded daily goal', () => {
    expect(profileSchema.safeParse({ name: '', daily_target: 999 }).success).toBe(false);
  });
});
