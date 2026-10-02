import { describe, it, expect } from 'vitest';
import {
  WAITING,
  createStatisticDesk,
  describeAnswer
} from '../../../src/group-comparison/statistic.js';
import { createConnection, formatStatistic } from '../../../src/r/index.js';

// The statistics line (#9): what R answered, through the connection and the
// shared formatter, and never an answer for rows other than the ones drawn.

// A stand-in for R whose answers arrive when the test says so.
function slowEngine() {
  const calls = [];
  return {
    calls,
    engine: {
      start: async () => {},
      call: (name, request) =>
        new Promise((resolve, reject) => calls.push({ name, ...request, resolve, reject }))
    }
  };
}
const answer = (p) => ({
  status: 'ok',
  reason: null,
  method: 'Wilcoxon rank sum test with continuity correction',
  p_value: p,
  adjustment: 'none',
  counts: { Placebo: 95, Treatment: 91 }
});
const request = (rows) => ({
  name: 'Analyze_GroupDifference',
  data: rows,
  args: { strValueCol: 'y', strGroupCol: 'x' },
  dataId: { rows: rows.length }
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('group comparison: the statistics line', () => {
  it('GC-STAT-001: with no R attached the line reads exactly what the connection answers (#9)', async () => {
    const desk = createStatisticDesk({ connection: createConnection(), formatStatistic });
    const shown = [];
    const wasShown = await desk
      .begin()
      .ask(request([{ y: 1, x: 'A' }]), (line) => shown.push(line));
    expect(wasShown).toBe(true);
    expect(shown).toEqual([
      { state: 'waiting', text: WAITING },
      {
        state: 'unavailable',
        text: 'Statistics are unavailable: no R is attached to this chart.'
      }
    ]);
  });

  it('GC-STAT-002: the line says it is waiting from the moment a result is asked for until it arrives (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = createStatisticDesk({
      connection: createConnection({ browser: { engine } }),
      formatStatistic
    });
    const shown = [];
    const asked = desk.begin().ask(request([{ y: 1, x: 'A' }]), (line) => shown.push(line));
    // At once, before R has been reached.
    expect(shown).toEqual([{ state: 'waiting', text: 'Statistics: waiting for R…' }]);
    await settle();
    expect(shown).toHaveLength(1);
    expect(calls).toHaveLength(1);
    calls[0].resolve(answer(0.031));
    expect(await asked).toBe(true);
    expect(shown[1]).toEqual({
      state: 'shown',
      text: 'Wilcoxon rank sum test with continuity correction: p = 0.031 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    });
  });

  it('GC-STAT-003: the request carries the rows that were drawn, the names of their fields and what the rows are (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = createStatisticDesk({
      connection: createConnection({ browser: { engine } }),
      formatStatistic
    });
    const rows = [
      { USUBJID: 'BIO-001', y: -1.027, x: 'Placebo' },
      { USUBJID: 'BIO-002', y: 0.4, x: 'Treatment' }
    ];
    desk.begin().ask(request(rows), () => {});
    await settle();
    expect(calls[0].name).toBe('Analyze_GroupDifference');
    expect(calls[0].data).toEqual(rows);
    expect(calls[0].args).toEqual({ strValueCol: 'y', strGroupCol: 'x' });
  });

  it('GC-STAT-004: an answer that arrives after the chart has been drawn again is never shown (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = createStatisticDesk({
      connection: createConnection({ browser: { engine } }),
      formatStatistic
    });
    const line = [];
    const show = (entry) => line.push(entry);

    // Drawn once, on 186 rows; then a filter changes and it is drawn again on 84.
    const first = desk.begin().ask(request(new Array(186).fill({ y: 1, x: 'A' })), show);
    await settle();
    const second = desk.begin().ask(request(new Array(84).fill({ y: 1, x: 'A' })), show);
    await settle();
    expect(calls.map((call) => call.data.length)).toEqual([186, 84]);
    // The line went back to waiting the moment the second drawing asked.
    expect(line.map((entry) => entry.state)).toEqual(['waiting', 'waiting']);

    // The second answer arrives first, and is shown.
    calls[1].resolve(answer(0.2));
    expect(await second).toBe(true);
    expect(line[line.length - 1].text).toContain('p = 0.200');

    // The first arrives late, and is dropped: the line still reads the second.
    calls[0].resolve(answer(0.001));
    expect(await first).toBe(false);
    expect(line).toHaveLength(3);
    expect(line[line.length - 1].text).toContain('p = 0.200');
  });

  it('GC-STAT-004: an answer still on its way when the chart is drawn again is dropped even if no other arrives (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = createStatisticDesk({
      connection: createConnection({ browser: { engine } }),
      formatStatistic
    });
    const line = [];
    const first = desk.begin().ask(request([{ y: 1, x: 'A' }]), (entry) => line.push(entry));
    await settle();
    desk.begin();
    calls[0].resolve(answer(0.04));
    expect(await first).toBe(false);
    expect(line).toEqual([{ state: 'waiting', text: WAITING }]);
  });

  it('GC-STAT-005: what R declined to compute, what the formatter refuses and what R reports as an error are each printed as such (#9)', async () => {
    expect(
      describeAnswer(
        {
          status: 'ok',
          value: {
            status: 'too_small',
            reason: 'fewer than 5 participants in Treatment',
            method: 'Welch Two Sample t-test',
            p_value: null,
            counts: { Placebo: 95, Treatment: 3 }
          }
        },
        formatStatistic
      )
    ).toEqual({
      state: 'withheld',
      text: 'Welch Two Sample t-test: not computed, fewer than 5 participants in Treatment (Placebo n = 95, Treatment n = 3).'
    });
    // A p-value with no method is never printed.
    expect(describeAnswer({ status: 'ok', value: { p_value: 0.01 } }, formatStatistic)).toEqual({
      state: 'refused',
      text: 'p-value not shown: the result does not name its method.'
    });
    expect(
      describeAnswer({ status: 'error', message: 'object not found' }, formatStatistic)
    ).toEqual({ state: 'error', text: 'R reported an error: object not found' });

    const { engine, calls } = slowEngine();
    const desk = createStatisticDesk({
      connection: createConnection({ browser: { engine } }),
      formatStatistic
    });
    const line = [];
    const asked = desk.begin().ask(request([{ y: 1, x: 'A' }]), (entry) => line.push(entry));
    await settle();
    calls[0].reject(new Error("Column 'y' (strValueCol) is not numeric."));
    expect(await asked).toBe(true);
    expect(line[1]).toEqual({
      state: 'error',
      text: "R reported an error: Column 'y' (strValueCol) is not numeric."
    });
  });
});
