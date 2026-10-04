// What the stratified survival chart draws, worked out from the tables: each
// participant's group and outcome, each group's Kaplan-Meier curve, the
// at-risk strip, and, for a cut variable, the values it is cut on.
//
// Pure functions: no page and no chart. Who is in the chart comes from the
// core's frame; a cut variable's groups from the shared cut rule; the curves
// from safety.viz's kit, `kmEstimate`, the descriptive product-limit estimate,
// handed in by the chart.
//
// The numbers here describe the participants: who is in each group, the
// survival estimate a curve draws, how many are at risk at a time, how many
// values fall in a bar of the histogram. None of them tests anything, and no
// confidence band is worked out: the log-rank test, the medians with their
// intervals and the hazard ratio are R's, asked for through the connection.

import { frame } from '../core/frame.js';
import { cutOf, groupLabel, isCut } from '../shared/cut.js';
import { coreSettings } from '../shared/settings.js';
import { isBlank, keepFiltered, levelsOf } from '../shared/tables.js';
import { flagOf } from './configure.js';

/** Why a participant with a group is not drawn, as the chart says it. */
export const LEFT_OUT = Object.freeze({
  NO_OUTCOME: 'No outcome for the endpoint',
  SEVERAL_OUTCOMES: 'More than one outcome row for the endpoint',
  MISSING_OUTCOME: 'Time or flag is missing or not a number',
  NOT_A_FLAG: 'Flag is not 0 or 1',
  NEGATIVE_TIME: 'Time is negative'
});

const grouping = (by) => (isCut(by) ? by : { col: by });
const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * The endpoints of an outcomes table, by name with numbers as numbers, each
 * with its label where the table has one.
 * @param {object[]} outcomes The outcomes table.
 * @param {object} settings The chart's settings.
 * @returns {Array<{endpoint: string, label: string}>}
 */
export function listEndpoints(outcomes, settings) {
  return levelsOf(outcomes.map((row) => row[settings.endpoint_col])).map((endpoint) => {
    const labelled = settings.endpoint_label_col
      ? outcomes.find(
          (row) =>
            String(row[settings.endpoint_col]) === endpoint &&
            !isBlank(row[settings.endpoint_label_col])
        )
      : null;
    return {
      endpoint,
      label: labelled ? String(labelled[settings.endpoint_label_col]) : endpoint
    };
  });
}

/**
 * Times to count the at-risk strip at: from 0 to the last time, in steps of 1,
 * 2, 2.5 or 5 times a power of ten, no more than six of them.
 * @param {number} last The last time drawn.
 * @returns {number[]} The times, ascending, the first 0.
 */
export function timeTicks(last) {
  if (!(last > 0)) return [0];
  const rough = last / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough);
  const ticks = [];
  for (let i = 0; i * step <= last * (1 + 1e-12); i += 1) {
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
}

/**
 * The bars of a histogram of values: equal widths from the least value to the
 * greatest, each with the number of values in it, the last bar holding the
 * greatest value.
 * @param {number[]} values The values.
 * @param {number} [count] How many bars.
 * @returns {Array<{from: number, to: number, n: number}>}
 */
export function histogramOf(values, count = 24) {
  if (!values.length) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return [{ from: low, to: high, n: values.length }];
  const width = (high - low) / count;
  const bars = Array.from({ length: count }, (_, i) => ({
    from: low + i * width,
    to: i === count - 1 ? high : low + (i + 1) * width,
    n: 0
  }));
  for (const value of values) {
    bars[Math.min(count - 1, Math.floor((value - low) / width))].n += 1;
  }
  return bars;
}

/**
 * Everything the chart is: who is in it, each participant's group and outcome,
 * each group's curve, the at-risk strip and, for a cut variable, its values and
 * how it was cut.
 *
 * @param {{results: object[], participants: ?object[], outcomes: object[]}} tables
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `endpoint`, `groupBy` (a
 *   column's name or a cut variable) and `filters`.
 * @param {object} options
 * @param {Function} options.kmEstimate safety.viz's estimator: observations
 *   `{ id, time, event }` to `{ points, censorTimes, riskTableAt }`.
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} `{ records, levels, curves, times, cut, values, bars,
 *   participants, dropped, unused, filtered, last }`. `records` holds one per
 *   participant drawn: the id, `group`, `time`, `flag` as the outcomes table
 *   gives it (censored or event, as the settings read it), and `event`.
 */
export function buildSurvival(
  { results, participants, outcomes },
  settings,
  state,
  { kmEstimate, filterMatches }
) {
  const config = coreSettings(settings);
  const idCol = config.id_col;
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    filterMatches
  );
  const empty = {
    records: [],
    levels: [],
    curves: [],
    times: [0],
    cut: null,
    values: [],
    bars: [],
    participants: kept ? kept.length : 0,
    dropped: [],
    unused: [],
    filtered: kept ? kept.length : null,
    last: 0
  };
  // Nobody left: the filters let no participant through, or those they let
  // through have no results. The core is not handed a table of no rows.
  if (!rows.length || !state.groupBy || state.endpoint === null) return empty;

  // A cut variable's points are worked out on the participants the filters
  // keep who have a value of it, whether or not they have an outcome.
  const cut = isCut(state.groupBy)
    ? cutOf({ results: rows, participants: kept }, state.groupBy, settings)
    : null;
  const made = frame(
    { results: rows, participants: kept || undefined },
    { group: grouping(state.groupBy) },
    config
  );

  // The endpoint's rows of the outcomes table, by participant.
  const outcomeId = settings.outcome_id_col || idCol;
  const flag = flagOf(settings);
  const byId = new Map();
  for (const row of outcomes) {
    if (String(row[settings.endpoint_col]) !== state.endpoint || isBlank(row[outcomeId])) continue;
    const id = String(row[outcomeId]);
    byId.set(id, [...(byId.get(id) || []), row]);
  }

  const left = new Map();
  const leave = (reason) => left.set(reason, (left.get(reason) || 0) + 1);
  const records = [];
  const values = [];
  for (const record of made.data) {
    const id = String(record[idCol]);
    if (cut) values.push(record.group);
    const found = byId.get(id) || [];
    if (!found.length) {
      leave(LEFT_OUT.NO_OUTCOME);
      continue;
    }
    if (found.length > 1) {
      leave(LEFT_OUT.SEVERAL_OUTCOMES);
      continue;
    }
    const time = numberOf(found[0][settings.time_col]);
    const flagged = numberOf(found[0][flag.col]);
    if (time === null || flagged === null) {
      leave(LEFT_OUT.MISSING_OUTCOME);
      continue;
    }
    if (flagged !== 0 && flagged !== 1) {
      leave(LEFT_OUT.NOT_A_FLAG);
      continue;
    }
    if (time < 0) {
      leave(LEFT_OUT.NEGATIVE_TIME);
      continue;
    }
    records.push({
      [idCol]: id,
      group: cut ? groupLabel(record.group, cut) : String(record.group),
      time,
      flag: flagged,
      event: flag.field === 'censor' ? flagged === 0 : flagged === 1
    });
  }

  // The groups, low to high for a cut, by name for a column, those with
  // someone drawn in them.
  const levels = cut
    ? cut.labels.filter((label) => records.some((record) => record.group === label))
    : levelsOf(records.map((record) => record.group));
  const last = records.reduce((most, record) => Math.max(most, record.time), 0);
  const times = settings.at_risk_times || timeTicks(last);
  const curves = levels.map((level) => {
    const members = records.filter((record) => record.group === level);
    const estimate = kmEstimate(
      members.map((record) => ({ id: record[idCol], time: record.time, event: record.event }))
    );
    return {
      level,
      n: members.length,
      events: members.filter((record) => record.event).length,
      estimate,
      risk: estimate.riskTableAt(times)
    };
  });

  return {
    ...empty,
    records,
    levels,
    curves,
    times,
    cut,
    values,
    bars: cut ? histogramOf(values) : [],
    participants: made.participants,
    dropped: [...made.dropped, ...[...left].map(([reason, n]) => ({ reason, n }))],
    unused: made.unused,
    last
  };
}

/**
 * The participants of a group at risk at a time: in the group, with a time at
 * or after it, as the at-risk strip counts them.
 * @param {object} model What `buildSurvival` gives.
 * @param {string} level The group.
 * @param {number} time The time.
 * @returns {object[]} The records.
 */
export function atRisk(model, level, time) {
  return model.records.filter((record) => record.group === level && record.time >= time);
}
