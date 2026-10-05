import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { compareValues, TOLERANCE } from '../../site/r-check/check.mjs';
import { describeAnswer } from '../../src/stratified-survival/statistic.js';
import { captureEvidence, captureGallery } from './evidence.js';
import { expectFailureSaid, expectReplacedConnectionDead } from './review.js';

// The stratified survival chart in a real page (#61): safety.viz's vendored
// bundle and bio.viz's committed bundle, loaded as two script tags, drawing the
// vendored synthetic study. `npm run test:e2e -- stratified-survival` runs this
// file.
//
// Every group but the last reaches no network and runs no R: the test is asked
// of a connection with no R attached, of one whose answers arrive when the test
// says, or of results desktop R stored. The last group, "live", opens the
// gallery's demo and runs real R from webR's public CDN, with the survival
// package installed in it, and holds what it answers to desktop R's.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
// What desktop R makes of each view (tools/r-survival.R). No number below was typed.
const fromR = readJson('../fixtures/stratified-survival-r.json');
const caseOf = (name) => fromR.cases.find((entry) => entry.case === name);
const keyed = ({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value });
const stored = (...names) => names.map(caseOf).map(keyed);
const FIXTURE = '/tests/e2e/fixtures/stratified-survival.html';
const NO_R = 'Statistics are unavailable: no R is attached to this chart.';
const CRP = { measure: 'CRP', visit: 'Baseline' };
const NEEDS =
  'This chart needs an outcomes table: give `outcomes`, one row per participant and endpoint, ' +
  'with a time and a flag, as `init({ results, participants, outcomes })`.';
const MOVING =
  'Statistics: R is asked when the cut line is let go. The curves are drawn for the cut where it is now.';

const blockR = (page) =>
  page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());

function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function open(page, { data = 'all', settings = null, make = true } = {}) {
  await blockR(page);
  await page.addInitScript((given) => {
    window.__ssSettings = given || {};
  }, settings);
  await page.goto(`${FIXTURE}?data=${data}${make ? '' : '&make=no'}`);
  await page.evaluate(() => window.__ss.ready);
}

const root = (page) => page.locator('#chart > .bv-stratified-survival');
const line = (page) => root(page).locator('.sv-main > .bv-statistic');
const footnote = (page) => root(page).locator('.sv-footnote');

const withStored = (page, results, settings = {}) =>
  page.evaluate(
    ({ results, settings }) => {
      window.__ss.chart.setSettings({
        ...settings,
        connection: window.BioViz.r.createConnection({ results })
      });
    },
    { results, settings }
  );

// The curves as drawn, read from the chart itself: each group's steps and its
// censor marks.
const curvesOf = (page) =>
  page.evaluate(() => {
    const [chart] = window.__ss.chart.charts;
    const of = (kind) =>
      chart.data.datasets
        .filter((dataset) => dataset.kind === kind)
        .map((dataset) => ({
          level: dataset.level,
          label: dataset.label,
          points: dataset.data.map((point) => [point.x, point.y])
        }));
    return { curves: of('curve'), censors: of('censor') };
  });

// R's survfit() steps for a group, as the chart draws them: from 1 at time 0,
// a step at each event time, and on to the group's last time.
function stepsOf(curve) {
  const steps = [[0, 1]];
  curve.time.forEach((time, i) => {
    if (curve.n_event[i] > 0) steps.push([time, curve.surv[i]]);
  });
  const last = curve.time[curve.time.length - 1];
  if (last > steps[steps.length - 1][0]) steps.push([last, steps[steps.length - 1][1]]);
  return steps;
}

function expectCurves(drawn, entry) {
  expect(drawn.curves.map((curve) => curve.level)).toEqual(entry.groups);
  for (const curve of entry.curves) {
    const ours = drawn.curves.find((found) => found.level === curve.group);
    const steps = stepsOf(curve);
    expect(
      ours.points.map(([x]) => x),
      curve.group
    ).toEqual(steps.map(([x]) => x));
    ours.points.forEach(([, y], i) =>
      expect(y, `${curve.group} ${i}`).toBeCloseTo(steps[i][1], 12)
    );
    const marks = drawn.censors.find((found) => found.level === curve.group).points;
    expect(
      marks.map(([x]) => x),
      curve.group
    ).toEqual(curve.time.filter((_, i) => curve.n_censor[i] > 0));
  }
}

// The at-risk strip as drawn.
const stripOf = (page) =>
  page.evaluate(() => {
    const table = document.querySelector('#chart .bv-risk');
    return {
      times: [...table.querySelectorAll('thead th')].slice(1).map((th) => Number(th.textContent)),
      rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
        group: tr.querySelector('th').textContent,
        counts: [...tr.querySelectorAll('td button')].map((button) => Number(button.textContent))
      }))
    };
  });

// R's answer as the line prints it: the medians in the legend's order, low to
// high for a cut, and a cut's hazard ratio named high over low.
const described = (entry) =>
  describeAnswer(
    { status: 'ok', value: entry.value },
    {
      levels: entry.groups,
      highOverLow: typeof entry.dataId.group_by === 'object'
    }
  );

async function expectAnswer(page, entry) {
  const said = described(entry);
  await expect(line(page)).toHaveAttribute('data-state', said.state);
  await expect(line(page).locator('.bv-stat-result')).toHaveText(said.text);
  await expect(line(page).locator('.bv-stat-estimate')).toHaveText(said.estimates || []);
  await expect(line(page).locator('.bv-stat-remark')).toHaveText(
    said.remarks.map((remark) => remark.text)
  );
}

test.describe('stratified survival: the page and the two bundles', () => {
  test('SS-KIT-003: the chart carries safety.viz’s Experimental banner at its top, in the kit’s markup and styles, saying its curves are safety.viz’s estimator, which awaits its clinical review (#78)', async ({
    page
  }) => {
    await open(page);
    const banner = root(page).locator('.sv-main > .sv-experimental');
    await expect(banner).toHaveCount(1);
    await expect(banner).toHaveAttribute('role', 'note');
    await expect(banner.locator('.sv-prototype-tag')).toHaveText('Experimental');
    await expect(banner.locator('.sv-prototype-text')).toHaveText(
      'This chart is experimental: its curves are safety.viz’s Kaplan–Meier estimator, kmEstimate, which awaits its clinical review. It is tested and documented, but its behaviour and settings may change.'
    );
    // First in the chart, above its titles, and drawn by the kit's styles.
    const placed = await page.evaluate(() => {
      const main = document.querySelector('#chart > .bv-stratified-survival .sv-main');
      const shown = getComputedStyle(main.querySelector('.sv-experimental'));
      return {
        first: main.firstElementChild.classList.contains('sv-experimental'),
        border: shown.borderLeftStyle
      };
    });
    expect(placed).toEqual({ first: true, border: 'solid' });
    // It stays when the chart draws again.
    await page.evaluate(() => window.__ss.chart.setSettings({ group_by: 'ARM' }));
    await expect(banner).toHaveCount(1);
  });

  test('SS-KIT-001: the chart is built from safety.viz’s kit on the page, its curves the kit’s kmEstimate drawn with the kit’s Chart.js; without safety.viz it says what is missing (#61)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const found = await page.evaluate(() => ({
      ownChart: 'Chart' in window.BioViz,
      drawsWithKit: window.__ss.chart.charts.every(
        (chart) => chart instanceof window.SafetyViz.kit.Chart
      ),
      charts: window.__ss.chart.charts.length,
      root: document.querySelector('#chart > .sv-root').className,
      sections: [...document.querySelectorAll('#chart .sv-section-title')].map(
        (title) => title.textContent
      ),
      // The kit's own estimator on the same participants gives the same curve.
      same: (() => {
        const chart = window.__ss.chart;
        const curve = chart.model.curves[0];
        const members = chart.model.records
          .filter((record) => record.group === curve.level)
          .map((record) => ({ id: record.USUBJID, time: record.time, event: record.event }));
        return (
          JSON.stringify(window.SafetyViz.kit.kmEstimate(members).points) ===
          JSON.stringify(curve.estimate.points)
        );
      })()
    }));
    expect(found).toEqual({
      ownChart: false,
      drawsWithKit: true,
      charts: 2,
      root: 'sv-root bv-stratified-survival',
      sections: ['View', 'Filters'],
      same: true
    });
    expect(errors).toEqual([]);
    await page.goto('/tests/e2e/fixtures/index.html');
    const message = await page.evaluate(() => {
      try {
        window.BioViz.stratifiedSurvival(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the stratified survival chart is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('stratified survival: what is drawn', () => {
  test('SS-DRAW-001: event-free survival by CRP at Baseline cut at its median: each group’s curve is R’s survfit() estimate, step for step, with its censored times marked, and high CRP has the worse survival, as the study was planted (#61)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const entry = caseOf('crp-median');
    const drawn = await curvesOf(page);
    expectCurves(drawn, entry);
    expect(drawn.curves.map((curve) => curve.label)).toEqual(
      entry.curves.map((curve) => `${curve.group} (n = ${curve.n_risk[0]})`)
    );
    // The planted effect: R's median survival is shorter above the median of CRP.
    const medians = Object.fromEntries(
      entry.value.estimates
        .filter((row) => row.name === 'Median')
        .map((row) => [row.group, row.estimate])
    );
    expect(medians['> 2.783']).toBeLessThan(medians['≤ 2.783']);
    await expect(root(page).locator('.sv-notes')).toContainText('200 of 200 participants drawn.');
    await expect(footnote(page)).toContainText('CRP at Baseline is cut at its median, 2.783');
    // The gallery's picture of the chart, with R's answer stored in the page.
    await withStored(page, stored('crp-median'));
    await expectAnswer(page, entry);
    expect(errors).toEqual([]);
    await captureEvidence(root(page).locator('.sv-main'), 'SS-DRAW-001', 'crp-median');
    // The gallery's picture: the chart's frame titled as its demo is, with its
    // footnotes and its own last (#66).
    await page.evaluate((titles) => window.__ss.chart.setSettings(titles), {
      title: '{endpoint} by {group}',
      subtitle: '{n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ]
    });
    await captureGallery(root(page).locator('.sv-main'), 'SS-DRAW-001');
  });

  test('SS-DRAW-002: groups from a column are drawn by name, and a cut at its tertiles makes three curves, low to high, each R’s; a column has no histogram (#61)', async ({
    page
  }) => {
    await open(page, { settings: { group_by: 'ARM' } });
    expectCurves(await curvesOf(page), caseOf('arm'));
    await expect(root(page).locator('.bv-hist')).toBeHidden();
    await page.evaluate(() =>
      window.__ss.chart.setSettings({
        group_by: { measure: 'CRP', visit: 'Baseline', cut: 'tertiles' }
      })
    );
    expectCurves(await curvesOf(page), caseOf('crp-tertiles'));
    await expect(root(page).locator('.bv-hist')).toBeVisible();
  });

  test('SS-RISK-002: the at-risk strip counts, at each time of the axis, the participants of each group whose time is at or after it, as R’s survfit() counts them at risk (#61)', async ({
    page
  }) => {
    await open(page);
    const entry = caseOf('crp-median');
    const strip = await stripOf(page);
    expect(strip.times[0]).toBe(0);
    expect(strip.rows.map((row) => row.group)).toEqual(entry.groups);
    for (const row of strip.rows) {
      const counts = strip.times.map(
        (time) =>
          entry.ids.filter((_, i) => entry.group_of[i] === row.group && entry.time_of[i] >= time)
            .length
      );
      expect(row.counts, row.group).toEqual(counts);
    }
  });

  test('SS-HIST-001: for a cut biomarker the histogram shows the values the points were worked out on, with a line at each point and how many values fall in each group (#61)', async ({
    page
  }) => {
    await open(page);
    const entry = caseOf('crp-median');
    const histogram = await page.evaluate(() => {
      const chart = window.__ss.chart.charts[1];
      return {
        total: chart.data.datasets[0].data.reduce((sum, bar) => sum + bar.y, 0),
        points: window.__ss.chart.model.cut.points
      };
    });
    expect(histogram.total).toBe(entry.n_values);
    expect(histogram.points).toEqual(entry.points);
    const counts = entry.groups.map(
      (group) => `${group}: ${entry.group_of.filter((found) => found === group).length}`
    );
    await expect(root(page).locator('.bv-cut-counts')).toHaveText(
      `Values each side of the cut: ${counts.join(' · ')}.`
    );
  });
});

test.describe('stratified survival: moving the cut line', () => {
  test('SS-DRAG-001: dragging the cut line moves the curves at once and asks R nothing; letting it go makes the cut a typed point, as its label writes it, held by the Groups control, and asks R once (#61)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    await page.evaluate(() => {
      window.__runs = [];
      window.__ss.chart.setSettings({
        connection: {
          run: (name, request) => {
            window.__runs.push(request.args.chrGroups);
            return Promise.resolve({ status: 'unavailable', reason: 'not-precomputed' });
          }
        }
      });
    });
    expect(await page.evaluate(() => window.__runs.length)).toBe(1);
    const before = await curvesOf(page);
    const canvas = root(page).locator('.bv-hist canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const pixelOf = (value) =>
      page.evaluate((value) => window.__ss.chart.charts[1].scales.x.getPixelForValue(value), value);
    const from = await pixelOf(caseOf('crp-median').points[0]);
    const to = await pixelOf(4);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + (from + to) / 2, y, { steps: 4 });
    await page.mouse.move(box.x + to, y, { steps: 4 });
    // While held: the curves have moved, R has not been asked, and the line says so.
    const held = await curvesOf(page);
    expect(held.curves[0].points).not.toEqual(before.curves[0].points);
    await expect(line(page)).toHaveText(MOVING);
    expect(await page.evaluate(() => window.__runs.length)).toBe(1);
    await page.mouse.up();
    // Let go: one typed point, written to four significant digits, near 4.
    const [point] = await page.evaluate(() => window.__ss.chart.model.cut.points);
    expect(point).toBeCloseTo(4, 1);
    expect(String(point).replace('.', '').replace(/^0+/, '').length).toBeLessThanOrEqual(4);
    await expect(root(page).locator('select[data-control="group-by"] option:checked')).toHaveText(
      `CRP at Baseline, cut at ${point}`
    );
    expect(await page.evaluate(() => window.__runs.length)).toBe(2);
    expect(await page.evaluate(() => window.__runs[1])).toEqual([`> ${point}`, `≤ ${point}`]);
    const [asked] = await page.evaluate(() => window.__ss.chart.statistics());
    expect(asked.dataId.group_by).toEqual({ ...CRP, value: 'raw', cut: [point] });
    expect(errors).toEqual([]);
  });

  test('SS-DRAG-002: dropped at 4, R’s stored answer for the cut at 4 is found and printed: its log-rank test, its medians and its hazard ratio; the arrow keys move the line too (#61)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('crp-median', 'crp-at-4'));
    await expectAnswer(page, caseOf('crp-median'));
    const points = await page.evaluate(() => window.__ss.chart.dropCut(0, 4.0004));
    expect(points).toEqual([4]);
    expectCurves(await curvesOf(page), caseOf('crp-at-4'));
    await expectAnswer(page, caseOf('crp-at-4'));
    const [asked] = await page.evaluate(() => window.__ss.chart.statistics());
    expect(keyed({ ...asked, value: asked.answer.value })).toEqual(keyed(caseOf('crp-at-4')));
    // One bar to the right with the keyboard: a new typed point, asked again
    // once the keys rest.
    await root(page).locator('.bv-cut-handle').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    const [moved] = await page.evaluate(() => window.__ss.chart.model.cut.points);
    expect(moved).toBeGreaterThan(4);
  });

  test('SS-DRAG-004: a click on a cut line, with no drag, leaves it where it is and asks R nothing; a drag moves it by as much as the pointer moves, from where it took hold (#61)', async ({
    page
  }) => {
    await open(page);
    await page.evaluate(() => {
      window.__runs = 0;
      window.__ss.chart.setSettings({
        connection: {
          run: () => {
            window.__runs += 1;
            return Promise.resolve({ status: 'unavailable', reason: 'not-precomputed' });
          }
        }
      });
    });
    expect(await page.evaluate(() => window.__runs)).toBe(1);
    const median = caseOf('crp-median').points[0];
    const canvas = root(page).locator('.bv-hist canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const pixelOf = (value) =>
      page.evaluate((value) => window.__ss.chart.charts[1].scales.x.getPixelForValue(value), value);
    const at = await pixelOf(median);
    const y = box.y + box.height / 2;
    // A click six pixels right of the line.
    await page.mouse.click(box.x + at + 6, y);
    expect(await page.evaluate(() => window.__ss.chart.model.cut.points)).toEqual([median]);
    expect(await page.evaluate(() => window.__ss.chart.model.cut.cut)).toBe('median');
    expect(await page.evaluate(() => window.__runs)).toBe(1);
    // Taken hold of six pixels to its right and moved forty: the line moves forty.
    await page.mouse.move(box.x + at + 6, y);
    await page.mouse.down();
    await page.mouse.move(box.x + at + 46, y, { steps: 5 });
    await page.mouse.up();
    const [dropped] = await page.evaluate(() => window.__ss.chart.model.cut.points);
    const expected = await page.evaluate(
      (pixel) => window.__ss.chart.charts[1].scales.x.getValueForPixel(pixel),
      at + 40
    );
    expect(Math.abs(dropped - expected)).toBeLessThan(0.05);
    expect(await page.evaluate(() => window.__runs)).toBe(2);
  });

  test('SS-DRAG-005: each cut line is a slider of its own: at the tertiles the second line takes the focus and its arrows move it, the curves at once, R once the keys rest; it stops at its neighbours and inside the values (#61)', async ({
    page
  }) => {
    await open(page, { settings: { group_by: { ...CRP, cut: 'tertiles' } } });
    await page.evaluate(() => {
      window.__runs = 0;
      window.__ss.chart.setSettings({
        connection: {
          run: () => {
            window.__runs += 1;
            return Promise.resolve({ status: 'unavailable', reason: 'not-precomputed' });
          }
        }
      });
    });
    const handles = root(page).locator('.bv-cut-handle');
    await expect(handles).toHaveCount(2);
    const [low, high] = caseOf('crp-tertiles').points;
    const second = handles.nth(1);
    await expect(second).toHaveAttribute('role', 'slider');
    await expect(second).toHaveAttribute('aria-valuenow', String(high));
    await expect(second).toHaveAttribute('aria-valuemin', String(low));
    await second.focus();
    const before = await page.evaluate(() => window.__runs);
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
    // The curves have moved while the keys were pressed, and the focus stays.
    await expect(handles.nth(1)).toBeFocused();
    const moving = await page.evaluate(() => window.__ss.chart.model.cut.points);
    expect(moving[0]).toBe(low);
    expect(moving[1]).toBeGreaterThan(high);
    // Once the keys rest, R is asked once, for typed points.
    await expect.poll(() => page.evaluate(() => window.__runs)).toBe(before + 1);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__runs)).toBe(before + 1);
    expect(await page.evaluate(() => Array.isArray(window.__ss.chart.model.cut.cut))).toBe(true);
    await expect(handles.nth(1)).toBeFocused();
    // Far left: it stops short of the first line.
    for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowLeft');
    await expect.poll(() => page.evaluate(() => window.__runs)).toBe(before + 2);
    const stopped = await page.evaluate(() => window.__ss.chart.model.cut.points);
    expect(stopped[1]).toBeGreaterThan(stopped[0]);
    // The first line, to the far left: it stops at the least value.
    await handles.first().focus();
    await page.keyboard.press('Home');
    await expect.poll(() => page.evaluate(() => window.__runs)).toBe(before + 3);
    const least = await page.evaluate(() => Math.min(...window.__ss.chart.model.values));
    expect(
      (await page.evaluate(() => window.__ss.chart.model.cut.points))[0]
    ).toBeGreaterThanOrEqual(Number(least.toPrecision(4)));
  });

  test('SS-DRAG-003: an answer asked for before the line was taken hold of is never shown: the line waits for the cut it is let go at (#61)', async ({
    page
  }) => {
    await open(page);
    await page.evaluate(() => {
      window.__pending = [];
      window.__ss.chart.setSettings({
        connection: {
          run: (name, request) =>
            new Promise((resolve) => window.__pending.push({ request, resolve }))
        }
      });
    });
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    await page.evaluate(() => window.__ss.chart.moveCut(0, 3.5));
    await expect(line(page)).toHaveText(MOVING);
    await page.evaluate(() => window.__ss.chart.dropCut(0, 4));
    await expect.poll(() => page.evaluate(() => window.__pending.length)).toBe(2);
    // The answer for the median arrives late, and is dropped.
    await page.evaluate(
      (value) => window.__pending[0].resolve({ status: 'ok', value }),
      caseOf('crp-median').value
    );
    await page.waitForTimeout(250);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    await page.evaluate(
      (value) => window.__pending[1].resolve({ status: 'ok', value }),
      caseOf('crp-at-4').value
    );
    await expectAnswer(page, caseOf('crp-at-4'));
  });
});

test.describe('stratified survival: the statistics line', () => {
  test('SS-STAT-006: with no R attached the line says statistics are unavailable, the curves are still drawn, and nothing is fetched (#61)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).hostname));
    await open(page);
    await expect(line(page)).toHaveText(NO_R);
    expectCurves(await curvesOf(page), caseOf('crp-median'));
    expect(requests.filter((host) => /r-wasm/.test(host))).toEqual([]);
  });

  test('SS-STAT-007: R’s answers stored in the page are found for the women alone and for a column, and a group below R’s minimum size prints R’s reason (#61)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('crp-median-women', 'arm', 'crp-at-10'));
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    expectCurves(await curvesOf(page), caseOf('crp-median-women'));
    await expectAnswer(page, caseOf('crp-median-women'));
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      'This test is of the 91 participants drawn, on Event-free survival (months). Filters: SEX is F.'
    );
    await root(page).locator('select[data-filter="SEX"]').selectOption('__all__');
    await page.evaluate(() => window.__ss.chart.setSettings({ group_by: 'ARM' }));
    await expectAnswer(page, caseOf('arm'));
    await page.evaluate(() =>
      window.__ss.chart.setSettings({ group_by: { measure: 'CRP', visit: 'Baseline', cut: [10] } })
    );
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(line(page)).toContainText(caseOf('crp-at-10').value.reason);
  });

  test('SS-STAT-008: where R does not estimate the hazard ratio, it is not printed, and R’s note says why (#61)', async ({
    page
  }) => {
    await open(page, { make: false });
    const entry = caseOf('no-events-in-one-arm');
    await page.evaluate(
      ({ tables, results }) => {
        window.__ss.chart = window.BioViz.stratifiedSurvival('#chart', {
          group_by: 'ARM',
          connection: window.BioViz.r.createConnection({ results })
        }).init(tables);
      },
      { tables: entry.tables, results: stored('no-events-in-one-arm') }
    );
    expectCurves(await curvesOf(page), entry);
    await expectAnswer(page, entry);
    await expect(line(page)).not.toContainText('Hazard ratio (');
    await expect(line(page)).toContainText('The hazard ratio is not estimable: Late has no events');
    await captureEvidence(
      root(page).locator('.sv-main'),
      'SS-STAT-008',
      'hazard-ratio-not-estimable'
    );
  });
});

test.describe('stratified survival: the tables', () => {
  test('SS-NEED-001: loaded without an outcomes table, the chart says it needs one, draws nothing and keeps its controls (#61)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'no-outcomes' });
    await expect(footnote(page)).toHaveText(NEEDS);
    expect(await page.evaluate(() => window.__ss.chart.charts.length)).toBe(0);
    await expect(root(page).locator('select[data-control="group-by"]')).toHaveCount(1);
    await expect(line(page)).toBeEmpty();
    expect(errors).toEqual([]);
    // Given one, it draws.
    await page.evaluate(() =>
      window.BioVizDemo.loadOutcomes('/site/data/synthetic-study/').then((outcomes) =>
        window.__ss.chart.setData({ ...window.__ss.data, outcomes })
      )
    );
    expectCurves(await curvesOf(page), caseOf('crp-median'));
    // Outcome rows for participants neither table has are not used, and counted.
    await page.evaluate(() =>
      window.BioVizDemo.loadOutcomes('/site/data/synthetic-study/').then((outcomes) =>
        window.__ss.chart.setData({
          ...window.__ss.data,
          outcomes: [
            ...outcomes,
            { USUBJID: 'NOBODY-1', PARAMCD: 'EFS', AVAL: '3', CNSR: '0' },
            { USUBJID: 'NOBODY-2', PARAMCD: 'EFS', AVAL: '4', CNSR: '1' }
          ]
        })
      )
    );
    await expect(root(page).locator('.sv-notes')).toContainText(
      '2 rows not used: Outcome row for no such participant.'
    );
    // An outcomes table without the column a setting names is refused by name.
    const message = await page.evaluate(() => {
      try {
        window.__ss.chart.setData({ ...window.__ss.data, outcomes: [{ USUBJID: 'BIO-001' }] });
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toBe('bio.viz: the outcomes table has no column `PARAMCD` (`endpoint_col`).');
  });

  test('SS-EVENT-001: an outcomes table flagged by event, 1 for an event, is read the other way round: the same curves, and R is asked with strEventCol and finds its answer (#61)', async ({
    page
  }) => {
    await open(page, { make: false });
    const entry = caseOf('crp-median-event-flag');
    await page.evaluate(
      ({ outcomes, results }) => {
        window.__ss.chart = window.BioViz.stratifiedSurvival('#chart', {
          group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
          event_col: 'EVENT',
          connection: window.BioViz.r.createConnection({ results })
        }).init({ ...window.__ss.data, outcomes });
      },
      { outcomes: entry.tables.outcomes, results: stored('crp-median-event-flag') }
    );
    expectCurves(await curvesOf(page), entry);
    await expectAnswer(page, entry);
    const [asked] = await page.evaluate(() => window.__ss.chart.statistics());
    expect(asked.args).toEqual(entry.args);
    // Named alone, later, the event column reads the table the other way round,
    // as it does when the chart is made: through setSettings and setData.
    const later = await page.evaluate((outcomes) => {
      const both = outcomes.map((row) => ({ ...row, CNSR: String(1 - Number(row.EVENT)) }));
      const chart = window.BioViz.stratifiedSurvival('#chart', {
        group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' }
      }).init({ ...window.__ss.data, outcomes: both });
      chart.setSettings({ event_col: 'EVENT' });
      const fromSettings = [chart.settings.censor_col, chart.settings.event_col];
      chart.setData({ ...window.__ss.data, outcomes }, { event_col: 'EVENT' });
      return { fromSettings, fromData: [chart.settings.censor_col, chart.settings.event_col] };
    }, entry.tables.outcomes);
    expect(later).toEqual({ fromSettings: [null, 'EVENT'], fromData: [null, 'EVENT'] });
  });

  test('SS-STAT-010: where some participants have a value and no outcome, the median is the median of those drawn, as R’s Analyze_Screen takes it: the cut, each group’s count and R’s answer are the ones desktop R gives (#61)', async ({
    page
  }) => {
    await open(page, { make: false });
    const entry = caseOf('crp-median-30-without-outcome');
    await page.evaluate(
      ({ outcomes, results }) => {
        window.__ss.chart = window.BioViz.stratifiedSurvival('#chart', {
          group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
          connection: window.BioViz.r.createConnection({ results })
        }).init({ ...window.__ss.data, outcomes });
      },
      { outcomes: entry.tables.outcomes, results: stored('crp-median-30-without-outcome') }
    );
    expect(await page.evaluate(() => window.__ss.chart.model.cut.points)).toEqual(entry.points);
    expectCurves(await curvesOf(page), entry);
    await expectAnswer(page, entry);
    await expect(root(page).locator('.sv-notes')).toContainText(
      '30 left out: No outcome for the endpoint.'
    );
    await expect(footnote(page)).toContainText(
      'Only participants with an outcome for the endpoint are cut'
    );
  });
});

test.describe('stratified survival: listing and participant profile', () => {
  test('SS-LIST-001: a click on a curve lists its group’s participants, and a count of the at-risk strip those it counts, the ones R puts there; a row opens that participant’s profile (#61)', async ({
    page
  }) => {
    await open(page);
    const entry = caseOf('crp-median');
    const group = entry.groups[1];
    // A click on the curve, near its first step.
    const point = await page.evaluate((group) => {
      const chart = window.__ss.chart.charts[0];
      const index = chart.data.datasets.findIndex(
        (dataset) => dataset.kind === 'curve' && dataset.level === group
      );
      const step = chart.getDatasetMeta(index).data[2];
      return { x: step.x, y: step.y };
    }, group);
    const curves = root(page).locator('.sv-chart-wrap canvas');
    await curves.scrollIntoViewIfNeeded();
    const box = await curves.boundingBox();
    await page.mouse.click(box.x + point.x, box.y + point.y);
    const listed = await page.evaluate(() =>
      window.__ss.chart.host.currentTableData.map((row) => row.USUBJID)
    );
    expect(listed.sort()).toEqual(entry.ids.filter((_, i) => entry.group_of[i] === group).sort());
    await expect(footnote(page)).toContainText(`${group}: ${listed.length} participants listed.`);
    // A click away from every curve lists nothing new.
    await page.evaluate(() => window.__ss.chart.clearSelection());
    await page.mouse.click(box.x + box.width - 60, box.y + 30);
    expect(await page.evaluate(() => window.__ss.chart.host.currentTableData.length)).toBe(0);
    // The legend hides neither a curve nor its marks.
    const legendHidden = await page.evaluate(() => {
      const chart = window.__ss.chart.charts[0];
      chart.options.plugins.legend.onClick({}, { datasetIndex: 0 }, chart.legend);
      return chart.data.datasets.map((_, index) => !chart.isDatasetVisible(index));
    });
    expect(legendHidden.every((hidden) => hidden === false)).toBe(true);
    // A count of the strip: those at risk at the second time.
    const strip = await stripOf(page);
    const time = strip.times[1];
    await root(page).locator(`.bv-risk button[data-group="${group}"][data-time="${time}"]`).click();
    const atRisk = await page.evaluate(() =>
      window.__ss.chart.host.currentTableData.map((row) => row.USUBJID)
    );
    expect(atRisk.sort()).toEqual(
      entry.ids.filter((_, i) => entry.group_of[i] === group && entry.time_of[i] >= time).sort()
    );
    // A row opens that participant's profile: the rail names them.
    const rail = page.locator('#chart .sv-rail');
    const first = await page
      .locator('.sv-listing tbody tr')
      .first()
      .locator('td')
      .first()
      .textContent();
    await expect(rail).not.toContainText(first);
    await page.locator('.sv-listing tbody tr').first().click();
    await expect(rail).toContainText(first);
    await captureEvidence(page.locator('.sv-listing'), 'SS-LIST-001', 'participants-at-risk');
  });
});

test.describe('stratified survival: on a phone and on the site', () => {
  test('SS-MOBILE-001: at 390px the controls are folded away, the at-risk strip fits or scrolls inside its own box, and the page does not scroll sideways (#61)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await open(page);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
    expect(await measure()).toEqual({ viewport: 390, scrollWidth: 390 });
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    await captureEvidence(root(page), 'SS-MOBILE-001', 'the-curves-on-a-phone');
    await context.close();
  });

  test('SS-SITE-002: the gallery lists the chart with links to its live demo, its evidence page and its API reference, and the demo opens on event-free survival by CRP at Baseline cut at its median (#61)', async ({
    page
  }) => {
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="stratified-survival"]');
    await expect(card.locator('h3')).toHaveText('Stratified survival');
    await expect(card).toContainText('Do participants with high and low levels');
    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/stratified-survival\/evidence\.html$/);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The stratified survival chart');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^stratifiedSurvival\(/ })
    ).toHaveCount(1);
    await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page).toHaveURL(/\/_site\/stratified-survival\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Stratified survival');
    await page.waitForFunction(() => Boolean(window.BioVizDemo && window.BioVizDemo.ready));
    await page.evaluate(() => window.BioVizDemo.ready);
    const levels = await page.evaluate(() => window.BioVizDemo.chart.model.levels);
    expect(levels).toEqual(caseOf('crp-median').groups);
    // Where R cannot be reached the curves are drawn all the same, and the line says so.
    await expect(
      page.locator('#chart > .bv-stratified-survival .sv-main > .bv-statistic')
    ).toHaveAttribute('data-state', 'unavailable');
  });

  test('SS-SITE-004: the gallery card and the live demo mark the chart Experimental, with the reason, as the registry gives it (#78)', async ({
    page
  }) => {
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="stratified-survival"]');
    await expect(card.locator('.module-status .status-experimental')).toHaveText('Experimental');
    await expect(card.locator('.module-status')).toContainText('awaits its clinical review');
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page.locator('.hero .module-status .status-experimental')).toHaveText(
      'Experimental'
    );
    await expect(page.locator('#chart .sv-experimental')).toHaveCount(1);
    // The other charts are not marked.
    await page.goto('/_site/gallery/index.html');
    await expect(page.locator('#charts .module-status')).toHaveCount(1);
  });

  test('SS-SITE-001: the live demo holds at a 390px-wide viewport with no horizontal scroll, with the controls open (#61)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await blockR(page);
    await page.goto('/_site/stratified-survival/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
    expect((await measure()).scrollWidth).toBeLessThanOrEqual((await measure()).viewport);
    await page.locator('.sv-sidebar-toggle').first().click();
    expect((await measure()).scrollWidth).toBeLessThanOrEqual((await measure()).viewport);
    // Each count of the at-risk strip stays on one line; the strip scrolls in
    // its own box when it is wider than the page.
    const wrapped = await page.evaluate(() =>
      [...document.querySelectorAll('#chart .bv-risk th, #chart .bv-risk td')]
        .filter((cell) => {
          // A text that wraps has more than one line box: rects at more than
          // one height.
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          const tops = new Set();
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(text);
            for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
          }
          return tops.size > 1;
        })
        .map((cell) => cell.textContent)
    );
    expect(wrapped).toEqual([]);
    const strip = await page.evaluate(() => {
      const wrap = document.querySelector('#chart .bv-risk-wrap');
      return { overflow: getComputedStyle(wrap).overflowX, width: wrap.clientWidth };
    });
    expect(strip.overflow).toBe('auto');
    await captureEvidence(page.locator('#demo'), 'SS-SITE-001', 'demo-on-a-phone');
    await context.close();
  });
});

test.describe('stratified survival: what the v0.1.0-RC1 review found, held here too', () => {
  test('SS-STAT-009: once the connection is replaced, a late answer from the old one changes neither the line nor what chart.statistics() reports (#61)', async ({
    page
  }) => {
    await expectReplacedConnectionDead(page, 'ss');
  });

  test('SS-FAIL-001: when drawing fails the chart says so in its element and keeps its controls, leaving nothing half drawn, and draws again once it can (#61)', async ({
    page
  }) => {
    await expectFailureSaid(page, 'ss', (name) => window[name].chart.charts.length);
  });
});

test.describe('stratified survival: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto('/_site/stratified-survival/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context.close();
  });

  const answered = () =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const found = document.querySelector(
              '#chart > .bv-stratified-survival .sv-main > .bv-statistic'
            );
            return found ? found.dataset.state : 'empty';
          }),
        { timeout: 260_000 }
      )
      .not.toMatch(/^(waiting|empty|none)$/);

  async function holdToDesktop(name) {
    const expected = caseOf(name);
    await answered();
    const [asked] = await page.evaluate(() => window.BioVizDemo.chart.statistics());
    expect(asked.answer.status, `${name}: ${asked.answer.message}`).toBe('ok');
    expect(asked.answer.form).toBe('browser');
    expect({ name: asked.name, args: asked.args, dataId: asked.dataId, rows: asked.rows }).toEqual({
      name: expected.name,
      args: expected.args,
      dataId: expected.dataId,
      rows: expected.rows
    });
    const differing = compareValues(expected.value, asked.answer.value).filter((row) => !row.ok);
    expect(differing, `${name}: within 1 part in ${1 / TOLERANCE.relative}`).toEqual([]);
    await expectAnswer(page, expected);
    return expected;
  }

  test('SS-LIVE-001: with R and the survival package started in this browser, the log-rank p, each median with its interval and the hazard ratio with its interval are desktop R’s, before and after the cut line is moved to 4 (#61)', async () => {
    await holdToDesktop('crp-median');
    await page.evaluate(() => window.BioVizDemo.chart.dropCut(0, 4));
    await holdToDesktop('crp-at-4');
    await captureEvidence(
      page.locator('#chart > .bv-stratified-survival .sv-main'),
      'SS-LIVE-001',
      'r-in-the-browser'
    );
  });

  test('SS-LIVE-002: by arm, a column, R in the browser is desktop R’s (#61)', async () => {
    await page.evaluate(() => window.BioVizDemo.chart.setSettings({ group_by: 'ARM' }));
    await holdToDesktop('arm');
  });
});
