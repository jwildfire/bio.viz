# The cross-tabulation

Is this category associated with that one? The chart draws a two-way table of counts, with its row and column totals and percentages, beside stacked bars of the same numbers. Under it, R's chi-square or Fisher's exact test of the table is printed with its method and counts, with R's own warning when an expected count is too small for chi-square. Either variable is a column, or a biomarker or a participant-level number cut by the core's shared [cut rule](core.md#the-cut-rule). A click on a count lists its participants, and a row of the listing opens safety.viz's participant profile.

```js
BioViz.crossTab('#chart', {
  row_by: 'ARM',
  col_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
  percent: 'row',
  test: 'chisq',
  connection: BioViz.r.createConnection({
    browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
  })
}).init({ results, participants });
```

## What the page loads

safety.viz's script-tag bundle first, then bio.viz's: the chart is built from safety.viz's kit, which it finds on the page as `SafetyViz.kit` when it is made, and its bars are drawn with the kit's Chart.js. Without safety.viz on the page the chart is refused with a message saying what is missing.

## `crossTab(element, settings)`

Makes the chart in `element`, a DOM element or a CSS selector for one, with `settings` laid over the defaults below. The controls are drawn at once; the tables are given to `init`. A setting that is not known, or a value a setting cannot take, is refused: `crossTab` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants }`, each an array of records, one object per row. They are the tables the [core](core.md) reads, and the column settings are the core's. Only the results table is required. With a participant table the chart shows a filter for each of its category columns, and offers those columns in the Rows and Columns controls; without one, a category comes from a column carried on the results rows that holds one value for each participant. When the filters together let nobody through, the chart draws nothing, asks R for nothing and reads `No participant passes the filters.`, the words every chart uses.

A participant table is matched to the results by the participant's id, in the column `participant_id_col` names, or `id_col`'s when that is not set. A participant table without that column is refused, with a message that names the column. A participant the results have and the participant table does not is left out and counted (`Not in the participant table`), and so is a row of results with no participant id (`Row has no participant id`). A participant with no category on either variable is left out and counted. If drawing fails for any other reason, the footnote says `This chart could not be drawn:` and why, nothing half drawn is left, and the controls stay.

## The chart's methods

| Method                          | What it does                                                                                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`              | Loads the tables and draws. The same as `setData`.                                                                                                                                                                                                                                                  |
| `chart.setData(data, settings)` | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table. `settings`, when given, are laid over the chart's with the tables, for tables that need them, and the tables are checked against those settings. |
| `chart.setSettings(settings)`   | Lays new settings over the current ones and draws again. A setting that says what the chart opens on (`row_by`, `col_by`, `percent`, `test`, `filters`) moves its control.                                                                                                                          |
| `chart.render()`                | Draws again from the tables, the settings and the controls, and asks R again.                                                                                                                                                                                                                       |
| `chart.listCell(row, col)`      | Lists the participants of one cell, as a click on its count does, and returns them.                                                                                                                                                                                                                 |
| `chart.statistics()`            | What the chart has asked R for the table now drawn and what R answered: `[{ name, args, dataId, rows, answer }]`, or none when nothing is asked.                                                                                                                                                    |
| `chart.resize()`                | Fits the bars to their container.                                                                                                                                                                                                                                                                   |
| `chart.destroy()`               | Takes the chart down. A destroyed chart cannot be used again.                                                                                                                                                                                                                                       |

## Settings

| Setting              | Default                 | What it is                                                                                                                                               |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`             | The participant's id, in the results table.                                                                                                              |
| `measure_col`        | `'TEST'`                | The biomarker's name.                                                                                                                                    |
| `value_col`          | `'STRESN'`              | The result.                                                                                                                                              |
| `visit_col`          | `'VISIT'`               | The visit.                                                                                                                                               |
| `visit_order_col`    | `'VISITNUM'`            | A number that orders the visits. May be null.                                                                                                            |
| `unit_col`           | `'STRESU'`              | The unit. May be null.                                                                                                                                   |
| `participant_id_col` | `null`                  | The participant's id in the participant table. Null means `id_col`'s name.                                                                               |
| `baseline_visits`    | `null`                  | The baseline visit, or a list of them, for a cut variable that is a change from baseline. Null means the first visit.                                    |
| `baseline_stat`      | `'mean'`                | How several baseline results are brought to one: `mean`, `min`, `max` or `first`.                                                                        |
| `row_by`             | `null`                  | The table's rows: a column's name, or a cut variable (`{ measure, visit, cut }` or `{ col, type: 'number', cut }`). Null means the first column offered. |
| `col_by`             | `null`                  | The table's columns, as `row_by` takes them. Null means the next column offered.                                                                         |
| `percent`            | `'row'`                 | What each cell's percentage is of: `row`, `col`, or `none`.                                                                                              |
| `cuts`               | `null`                  | Cut variables the Rows and Columns controls offer beside the columns, as a list.                                                                         |
| `measures`           | `null`                  | The biomarkers the participant profile shows, in order. Null means every biomarker.                                                                      |
| `groups`             | `null`                  | The columns the Rows and Columns controls offer, as `{ value_col, label }`. Null means every category column.                                            |
| `max_levels`         | `12`                    | The most different values a column may hold and still be a category.                                                                                     |
| `filters`            | `null`                  | The filters, as `{ value_col, label, start, all }`. Null means every category column of the participant table.                                           |
| `details`            | `null`                  | The listing's columns. Null means the participant, the row and the column.                                                                               |
| `page_size`          | `10`                    | The listing's rows on a page.                                                                                                                            |
| `connection`         | `null`                  | The connection to R ([`BioViz.r.createConnection`](r-connection.md)). Null means none: the line says statistics are unavailable.                         |
| `statistic`          | `'Analyze_Contingency'` | The R function the test is asked of. Null for no statistics line.                                                                                        |
| `test`               | `'chisq'`               | The test: `chisq`, chi-square; `fisher`, Fisher's exact; or `none`.                                                                                      |
| `waiting_note`       | `null`                  | A sentence the line adds while it waits, until R has answered once on the connection: what starting R costs on the page.                                 |
| `back`               | `null`                  | A way back, when another chart opened this one in its place: `{ label, action }`.                                                                        |
| `profile`            | `true`                  | Whether a row of the listing opens safety.viz's participant profile.                                                                                     |
| `profile_details`    | `null`                  | The columns the profile's header shows. Null means the category columns.                                                                                 |
| `studyday_col`       | `null`                  | The study day, for the profile. May be null.                                                                                                             |
| `normal_col_high`    | `null`                  | The upper limit of normal, for the profile. May be null.                                                                                                 |
| `normal_col_low`     | `null`                  | The lower limit of normal, for the profile. May be null.                                                                                                 |

## What is drawn

- The table: the row categories down the side and the column categories across, a count in each cell with its percentage of its row or its column beneath, the row totals, the column totals and the grand total. A column's categories are in order of name, numbers in them as numbers (Week 2 before Week 10), in the browser's own order; a cut's run low to high, labelled with their bounds. A value that is empty or only white space is missing, white space being what JavaScript's `trim()` removes, the non-breaking space and the other Unicode spaces among it. In R that is `trimws(x, whitespace = "[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")`, as `tools/r-cross-tab.R` reads it; `trimws()`'s default misses the non-breaking space. Every count is a button: a click, or Enter on it, lists that cell's participants.
- The bars: the same table as percentages, one stacked bar for each row split by the columns, or, with column percentages, one for each column split by the rows.
- The footnote: how to list a cell, and how each cut variable was cut (its points, how many values they were worked out on, and whether repeated points collapsed).

## The statistics line

R is asked once per table, with one row per participant: the id, `row` and `col`, each as text. The line says it is waiting until R answers, and a change to the rows, the columns, the test or a filter clears it and asks again; an answer to a question no longer on screen is never shown. What the percentages are of describes the same table: changing it redraws the table and the bars and asks R nothing. R's result is printed with its method and counts, labelled exploratory and unadjusted; with Fisher's exact test of a two-by-two table, R's odds ratio is printed with its interval. A table R withholds, a category below R's minimum size, prints R's reason and no number; R names the category by the column the chart handed it, `row` or `col`, and the line puts the table's name for that variable in its place (`Not computed: CRP at Baseline, cut at 10 = > 10 has 2.`). What R said about its answer is printed as R worded it, its warnings and its notes among them: for chi-square, when an expected count is below 5, R's note says so and that Fisher's exact test does not rely on the approximation. The chart computes no test statistic, no p-value and no expected count. With no R attached the table and the bars are still drawn, and the line says that statistics are unavailable.

### What R is asked

```js
connection.run('Analyze_Contingency', {
  data, // one row per participant: the id, row, col
  args: {
    strRowCol: 'row',
    strColCol: 'col',
    strMethod: 'chisq', // or 'fisher'
    chrRowGroups: ['Placebo', 'Treatment'], // a column's by code point, a cut's low to high
    chrColGroups: ['Non-responder', 'Responder']
  },
  dataId // what the rows are: see below
});
```

The categories R is handed are in an order that depends on nothing but them: a cut's low to high, a column's sorted by code point, as R's `sort(method = "radix")` sorts them. That is not always the order the table shows (`Week 10` comes before `Week 2`, upper case before lower, ASCII before `Ö`), and it is the same in every browser and every language, so a stored result written from R is found.

`dataId` states what the rows are, so a [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together:

| Member            | What it is                                                                                                            | Left out when                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `chart`           | `'cross-tab'`.                                                                                                        | never                                                     |
| `row_by`          | The rows: the column's name, or the cut variable as the settings write it, typed points as a list.                    | never                                                     |
| `col_by`          | The columns, written as `row_by` is.                                                                                  | never                                                     |
| `baseline_visits` | The setting, as a list.                                                                                               | the setting is null, or no cut biomarker reads a baseline |
| `baseline_stat`   | The setting.                                                                                                          | no cut biomarker reads a baseline                         |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point. | no filter is in force                                     |

A cut biomarker reads a baseline when its value is the baseline or a change from it (`value` other than `raw`); a table of columns, or of a biomarker's result itself, does not depend on the baseline settings, so they are not part of its key. The R recipe that writes the same key is `cross_tab_key` in `tools/r-cross-tab.R`, which writes the expected results the tests hold this chart to.

## On a phone

At 390 pixels the controls start folded away, the table scrolls inside its own box when it is wider than the screen, and the page does not scroll sideways.

## What is not here

No test statistic, p-value, expected count or adjustment is computed here: the chart counts and works out percentages, which describe the table, and every test is R's.
