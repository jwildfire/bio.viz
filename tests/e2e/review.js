import { expect } from '@playwright/test';

// What the v0.1.0-RC1 review found (#49), held in every chart the same way.
// Each chart's spec calls these with its own fixture; the assertions are here,
// once.

export const CHARTS = {
  gc: { fixture: 'group-comparison', name: '__gc' },
  as: { fixture: 'association-scatter', name: '__as' },
  cm: { fixture: 'correlation-matrix', name: '__cm' },
  bs: { fixture: 'biomarker-screen', name: '__bs' }
};

const blockR = (page) =>
  page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());

// Two connections: one whose answers arrive when the test says, and one that
// answers at once.
const CONNECTIONS = () => {
  window.__pending = [];
  window.__deferred = {
    run(name, request) {
      return new Promise((resolve) => window.__pending.push({ name, request, resolve }));
    }
  };
  window.__instant = { run: async () => ({ status: 'error', message: 'FRESH answer' }) };
};

async function openChart(page, key, settings = {}) {
  const { fixture, name } = CHARTS[key];
  await blockR(page);
  await page.addInitScript(CONNECTIONS);
  await page.addInitScript(
    ({ name, settings }) => {
      window[`${name}Settings`] = { ...settings, connection: window.__deferred };
    },
    { name, settings }
  );
  await page.goto(`/tests/e2e/fixtures/${fixture}.html`);
  await page.evaluate((name) => window[name].ready, name);
}

const errorsOf = (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
};

/**
 * Finding 2: after `setSettings({ connection })`, a late answer from the
 * connection that was replaced reaches neither the line nor `statistics()`.
 */
export async function expectReplacedConnectionDead(page, key, settings = {}) {
  const { name } = CHARTS[key];
  const errors = errorsOf(page);
  await openChart(page, key, settings);
  const line = page.locator('#chart .bv-statistic').first();
  await expect(line).toHaveAttribute('data-state', 'waiting');
  expect(await page.evaluate(() => window.__pending.length)).toBeGreaterThan(0);
  await page.evaluate(
    (name) => window[name].chart.setSettings({ connection: window.__instant }),
    name
  );
  await expect(line).toContainText('FRESH answer');
  // The connection that was replaced answers the question no longer on screen.
  await page.evaluate(() =>
    window.__pending
      .splice(0)
      .forEach((asked) => asked.resolve({ status: 'error', message: 'STALE answer' }))
  );
  await page.waitForTimeout(250);
  await expect(page.locator('#chart')).not.toContainText('STALE answer');
  const answers = await page.evaluate(
    (name) => window[name].chart.statistics().map((entry) => entry.answer && entry.answer.message),
    name
  );
  expect(answers.length).toBeGreaterThan(0);
  expect(answers.every((message) => message === 'FRESH answer')).toBe(true);
  expect(errors).toEqual([]);
}

/**
 * Render guard: when drawing fails, the chart says so in its element, keeps
 * its controls, and leaves nothing half drawn; once drawing works it draws.
 */
export async function expectFailureSaid(page, key, drawn) {
  const { name } = CHARTS[key];
  const errors = errorsOf(page);
  await openChart(page, key);
  const before = await page.locator('#chart .sv-footnote').textContent();
  const said = await page.evaluate((name) => {
    const chart = window[name].chart;
    const logged = [];
    const log = console.error;
    console.error = (...args) => logged.push(String(args[0] && args[0].message));
    // A listing, a selected participant and, on the screen, R's last answer:
    // none of it may outlive a failed drawing.
    chart.host.currentTableData = [{ USUBJID: 'BIO-001' }];
    chart.host.listingSelectedId = 'BIO-001';
    chart.answer = { status: 'ok', value: {} };
    chart.updateNotes = () => {
      throw new TypeError('bio.viz: a test made the drawing fail.');
    };
    try {
      chart.render();
    } finally {
      console.error = log;
    }
    return {
      logged,
      listing: chart.host.currentTableData.length,
      selected: chart.host.listingSelectedId,
      answer: chart.answer === undefined ? null : chart.answer,
      colour: getComputedStyle(document.querySelector('#chart .sv-footnote')).color
    };
  }, name);
  expect(errors).toEqual([]);
  expect(said.logged).toEqual(['bio.viz: a test made the drawing fail.']);
  expect(said).toMatchObject({ listing: 0, selected: null, answer: null });
  // The failure is said in the danger colour, where the footnote is otherwise grey.
  expect(said.colour).toBe('rgb(155, 28, 28)');
  await expect(page.locator('#chart .sv-footnote')).toHaveText(
    'This chart could not be drawn: a test made the drawing fail.'
  );
  await expect(page.locator('#chart .sv-footnote')).toHaveClass(/bv-failure/);
  await expect(page.locator('#chart .bv-statistic').first()).toHaveText('');
  expect(await page.evaluate(drawn, name)).toBe(0);
  // The controls are still there to change something with.
  expect(await page.locator('#chart .sv-sidebar select').count()).toBeGreaterThan(0);
  // Drawing works again: the chart draws, and the failure is gone.
  await page.evaluate((name) => {
    delete window[name].chart.updateNotes;
    window[name].chart.render();
  }, name);
  await expect(page.locator('#chart .sv-footnote')).toHaveText(before);
  await expect(page.locator('#chart .sv-footnote')).not.toHaveClass(/bv-failure/);
  expect(await page.evaluate(drawn, name)).toBeGreaterThan(0);
}

/**
 * Finding 3: with a participant table, the results of participants it does
 * not have, and rows with no participant id, are counted by reason; a
 * participant table without the id column is refused with a sentence.
 */
export async function expectDropsCounted(page, key) {
  const { name } = CHARTS[key];
  await openChart(page, key);
  const notes = await page.evaluate((name) => {
    const { chart, data } = window[name];
    const missing = new Set(data.participants.slice(0, 5).map((row) => row.USUBJID));
    const participants = data.participants.filter((row) => !missing.has(row.USUBJID));
    // Two rows of results lose their id.
    const results = data.results.map((row, index) => (index < 2 ? { ...row, USUBJID: '' } : row));
    chart.setData({ results, participants });
    return document.querySelector('#chart .sv-notes').textContent;
  }, name);
  expect(notes).toContain('5 left out: Not in the participant table.');
  expect(notes).toContain('2 rows not used: Row has no participant id.');

  const refused = await page.evaluate((name) => {
    const { chart, data } = window[name];
    const participants = data.participants.map(({ USUBJID, ...rest }) => ({
      SUBJID: USUBJID,
      ...rest
    }));
    try {
      chart.setData({ results: data.results, participants });
      return null;
    } catch (error) {
      return { error: error.message, shown: document.querySelector('#chart').textContent };
    }
  }, name);
  const sentence =
    'bio.viz: the participant table has no column `USUBJID`, which names the participant ' +
    '(`participant_id_col`, or `id_col` when that is not set).';
  expect(refused).toEqual({ error: sentence, shown: sentence });
}

/**
 * Finding 3, with filters: when the participant table lacks some of the
 * results' participants and the filters let nobody through, the chart says
 * nobody passes the filters, as it does with no such rows.
 */
export async function expectNobodyWithOrphans(page, key) {
  const { name } = CHARTS[key];
  const errors = errorsOf(page);
  await openChart(page, key);
  await page.evaluate((name) => {
    const { chart, data } = window[name];
    chart.setSettings({
      filters: [
        { value_col: 'AGE', label: 'Age' },
        { value_col: 'RESPONSE', label: 'Response' }
      ]
    });
    const missing = new Set(data.participants.slice(0, 5).map((row) => row.USUBJID));
    // Results for five participants the table does not have, and a row with no id.
    const results = data.results.map((row, index) => (index === 0 ? { ...row, USUBJID: '' } : row));
    chart.setData({
      results,
      participants: data.participants.filter((row) => !missing.has(row.USUBJID))
    });
  }, name);
  // No participant of 35 is a responder.
  await page.locator('#chart select[data-filter="AGE"]').selectOption('35');
  await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('Responder');
  await expect(page.locator('#chart .sv-footnote').first()).toHaveText(
    'No participant passes the filters.'
  );
  expect(errors).toEqual([]);
}

/**
 * Finding 3, through the settings: a setting that names a participant id
 * column the participant table does not have is refused with the same
 * sentence, before anything changes, and the chart stays as it was drawn.
 */
export async function expectSettingsRefused(page, key) {
  const { name } = CHARTS[key];
  const errors = errorsOf(page);
  await openChart(page, key);
  const before = await page.locator('#chart .sv-footnote').textContent();
  const refused = await page.evaluate((name) => {
    const { chart } = window[name];
    try {
      chart.setSettings({ participant_id_col: 'SUBJID' });
      return null;
    } catch (error) {
      return { error: error.message, setting: chart.settings.participant_id_col };
    }
  }, name);
  expect(refused).toEqual({
    error:
      'bio.viz: the participant table has no column `SUBJID`, which names the participant ' +
      '(`participant_id_col`, or `id_col` when that is not set).',
    setting: null
  });
  await expect(page.locator('#chart .sv-footnote')).toHaveText(before);
  expect(errors).toEqual([]);
}
