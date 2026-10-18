// The R check page. It asks R for two test results three ways — with no R
// attached, from results shipped with the page, and from R started in this
// browser — and shows each answer from the browser beside the one desktop R
// gave. It starts R only when the button is pressed, and times each call from
// the moment it is made.
//
// The page computes no statistic: every number it shows came from R, here or on
// the desktop, and the only arithmetic is the difference between the two.
//
// What it has done is also kept on `window.rCheck`, and the state of the R run
// on <body data-r-state>, so the browser test reads the same facts a visitor
// sees.

import { compareValues, parseCsv, showNumber } from './check.mjs';

const { createConnection, formatStatistic, WEBR_VERSION } = window.BioViz.r;

const NUMERIC = { 'alt-week-8.csv': ['AVAL'], 'days-on-study.csv': ['DAYS', 'DISCONTINUED'] };
const TITLES = { rank_sum: 'Wilcoxon rank-sum test', log_rank: 'Log-rank test' };

const $ = (id) => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const seconds = (milliseconds) => (milliseconds / 1000).toFixed(milliseconds < 1000 ? 3 : 1);
const show = (value) =>
  typeof value === 'number'
    ? showNumber(value)
    : value === undefined
      ? 'absent'
      : JSON.stringify(value);

const state = (window.rCheck = {
  ready: false,
  unavailable: null,
  precomputed: [],
  browser: null
});

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

// One labelled answer: the test's name and the sentence the formatter gives.
function answerItem(result, answer) {
  const item = el('li', undefined, 'answer');
  item.append(el('h3', TITLES[result.name]));
  item.append(el('p', result.dataId, 'answer-data'));
  item.append(
    el(
      'p',
      answer.status === 'ok' ? formatStatistic(answer.value).text : answer.message,
      'answer-text'
    )
  );
  return item;
}

// Every member of the expected value beside the browser's, in full, with the
// difference between the two numbers and whether they count as the same.
function comparisonList(rows) {
  const list = el('ul', undefined, 'comparison');
  for (const row of rows) {
    const item = el('li', undefined, row.ok ? 'same' : 'differs');
    item.dataset.path = row.path;
    item.dataset.ok = String(row.ok);
    item.append(el('h4', row.path));
    const facts = el('dl');
    const fact = (name, value) => {
      const pair = el('div');
      pair.append(el('dt', name), el('dd', value));
      facts.append(pair);
    };
    fact('Desktop R', show(row.expected));
    fact('This browser', show(row.actual));
    if (row.difference !== null) fact('Difference', showNumber(row.difference));
    fact('Verdict', row.ok ? 'Same' : 'Differs');
    item.append(facts);
    list.append(item);
  }
  return list;
}

function timingRow(label, milliseconds) {
  const row = el('tr');
  row.append(el('th', label), el('td', `${seconds(milliseconds)} s`));
  row.firstChild.scope = 'row';
  return row;
}

async function runInBrowser(expected, tables) {
  const button = $('start-r');
  const status = $('r-status');
  button.disabled = true;
  document.body.dataset.rState = 'running';
  status.textContent = `Starting R (webR ${WEBR_VERSION}) and running the rank-sum test…`;

  const record = (state.browser = { results: [], timings: {}, session: null, error: null });
  const connection = createConnection({
    browser: { sourceUrl: 'statistics.R', packages: ['survival'] }
  });
  const timed = async (name, request) => {
    const from = performance.now();
    const answer = await connection.run(name, request);
    return { answer, milliseconds: performance.now() - from };
  };
  const requestFor = (result) => ({ data: tables[result.file], args: result.args });
  const fail = (answer) => {
    record.error = answer.message;
    status.textContent = `R did not answer: ${answer.message}`;
    document.body.dataset.rState = 'failed';
    button.disabled = false;
  };

  // First calls. The first of them carries the whole cost of starting R.
  for (const [index, result] of expected.results.entries()) {
    const { answer, milliseconds } = await timed(result.name, requestFor(result));
    if (answer.status !== 'ok') return fail(answer);
    if (index === 0) record.timings.firstResult = milliseconds;
    else record.timings.secondTest = milliseconds;
    record.results.push({
      name: result.name,
      value: answer.value,
      form: answer.form,
      rows: compareValues(result.value, answer.value)
    });
    status.textContent = `${TITLES[result.name]} answered. Running the next step…`;
  }

  const session = await connection.run('r_session');
  if (session.status !== 'ok') return fail(session);
  record.session = session.value;

  // The same calls again, with R already running.
  record.timings.repeat = [];
  for (const result of expected.results) {
    const { answer, milliseconds } = await timed(result.name, requestFor(result));
    if (answer.status !== 'ok') return fail(answer);
    record.timings.repeat.push({ name: result.name, milliseconds });
  }

  // Show it.
  const made = expected.made_by;
  $('r-session').textContent =
    `R in this browser is ${record.session.r_version} with survival ` +
    `${record.session.survival_version}. The desktop answers were made by R ${made.r_version} ` +
    `with survival ${made.survival_version}.`;
  const comparisons = $('comparisons');
  comparisons.replaceChildren();
  for (const result of record.results) {
    const block = el('div', undefined, 'comparison-block');
    block.dataset.test = result.name;
    const same = result.rows.every((row) => row.ok);
    block.dataset.same = String(same);
    block.append(el('h3', TITLES[result.name]));
    block.append(el('p', formatStatistic(result.value).text, 'answer-text'));
    block.append(
      el(
        'p',
        same
          ? `Same as desktop R in all ${result.rows.length} values.`
          : `Differs from desktop R in ${result.rows.filter((row) => !row.ok).length} of ${result.rows.length} values.`,
        same ? 'verdict same' : 'verdict differs'
      )
    );
    // Shown outright: the headline numbers, and any value that differs from
    // desktop R at all, whether or not the tolerance lets it through. The rest,
    // identical to the last digit, are one click away.
    const headline = (row) =>
      ['p_value', 'statistic'].includes(row.path) || !row.ok || (row.difference || 0) !== 0;
    block.append(comparisonList(result.rows.filter(headline)));
    const identical = result.rows.filter((row) => !headline(row));
    if (identical.length > 0) {
      const rest = el('details');
      rest.append(
        el('summary', `The other ${identical.length} values, identical to desktop R's`),
        comparisonList(identical)
      );
      block.append(rest);
    }
    comparisons.append(block);
  }

  const timings = $('timings-body');
  timings.replaceChildren(
    timingRow('First result: from the call to the rank-sum answer', record.timings.firstResult),
    timingRow('Log-rank test, first call', record.timings.secondTest),
    ...record.timings.repeat.map((repeat) =>
      timingRow(`${TITLES[repeat.name]} again, R already running`, repeat.milliseconds)
    )
  );
  $('timings').hidden = false;

  const allSame = record.results.every((result) => result.rows.every((row) => row.ok));
  record.allSame = allSame;
  status.textContent = allSame
    ? 'Done. R in this browser gave the same answers as desktop R.'
    : 'Done. R in this browser gave a different answer from desktop R; see below.';
  document.body.dataset.rState = 'done';
}

async function main() {
  const expected = JSON.parse(await fetchText('expected.json'));
  const tables = {};
  for (const result of expected.results) {
    tables[result.file] = parseCsv(await fetchText(`data/${result.file}`), NUMERIC[result.file]);
  }
  const first = expected.results[0];

  // With no R attached.
  state.unavailable = await createConnection().run(first.name, {
    data: tables[first.file],
    args: first.args
  });
  $('unavailable-answer').textContent = state.unavailable.message;

  // From the results shipped with the page: the expected results are stored
  // results, handed to the connection as they are.
  const stored = createConnection({ results: expected.results });
  const answers = $('precomputed-answers');
  for (const result of expected.results) {
    const answer = await stored.run(result.name, {
      data: tables[result.file],
      args: result.args,
      dataId: result.dataId
    });
    state.precomputed.push({ name: result.name, answer });
    answers.append(answerItem(result, answer));
  }

  // From R in this browser: only when asked.
  $('start-r').addEventListener('click', () => {
    runInBrowser(expected, tables).catch((error) => {
      state.browser = { ...(state.browser || {}), error: error.message };
      $('r-status').textContent = `The check stopped: ${error.message}`;
      document.body.dataset.rState = 'failed';
    });
  });
  $('start-r').disabled = false;
  document.body.dataset.rState = 'idle';
  state.ready = true;
}

main().catch((error) => {
  $('r-status').textContent = `The page could not load its files: ${error.message}`;
  document.body.dataset.rState = 'failed';
});
