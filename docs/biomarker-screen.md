# The biomarker screen

Across every biomarker, where is the signal? The chart runs one comparison, chosen once, across every biomarker, and draws one row per biomarker. The comparison is a standardised difference between two groups, a correlation with one fixed variable, or, with an outcomes table, a hazard ratio for high against low on an endpoint, each biomarker cut at its median. Each row has R's estimate and its interval on one shared axis without units, so biomarkers measured on different scales can be read side by side. Beside it are R's p-values, unadjusted and adjusted across the rows, and the counts each row used. A click on a row opens that biomarker's own chart, in place, with a way back: the [group comparison](group-comparison.md) for a difference, the [association scatter](association-scatter.md) for a correlation, the [stratified survival chart](stratified-survival.md) for a hazard ratio.

It draws; it does not estimate. Every row's estimate, interval, p-value and adjustment is R's: the chart hands R one table through the [connection to R](r-connection.md), and gsm.bio's `Analyze_Screen` returns one row per biomarker with the adjustment across them. The chart orders the rows R returned, by R's estimate, by name or by R's adjusted p-value. It computes no estimate, no interval, no p-value, no adjustment and no key to sort by that R did not return. With no R attached it draws no rows, and the chart says that statistics are unavailable.

This is the one place where adjusting for many tests has a clear meaning: the family of tests is on the page, one row each. The adjusted p-value is labelled with the adjustment by name, and the caption says how many tests it covered. Every result is exploratory.

It is the way in to the single charts: find the biomarker here, then open its chart. It is built as the other three charts are, from the same parts, and takes the same tables and the same column settings.

## At a glance

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  const chart = BioViz.biomarkerScreen('#chart', {
    baseline_visits: 'Baseline',
    visit: 'Week 4',
    value_type: 'change',
    group_by: 'ARM',
    // R, started in the browser the first time the screen asks. Leave it out
    // and no rows are drawn, and the chart says that statistics are unavailable.
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

That is every biomarker's change from Baseline to Week 4, its first two arms compared, first less second. Named nothing, the chart opens on every biomarker at the first visit, as its result, between the first two groups of the first column of groups.

## What the page loads

Two script tags, safety.viz's first. The chart is built from safety.viz's kit (`SafetyViz.kit`): its control sidebar, its filters and, for the chart a row opens, its Chart.js. bio.viz bundles none of it; it finds the kit on the page when a chart is made, and says so plainly if it is not there. A hazard ratio calls R's survival package, as the [stratified survival chart](stratified-survival.md) does: R in the browser installs it when it is named in the connection's `browser.packages` (`packages: ['survival']`), which adds about 13 MB to R's first start.

## `biomarkerScreen(element, settings)`

Makes a chart in an element and returns it. `element` is the element, or a CSS selector for it. `settings` is laid over the [defaults](#settings) and may be left out. The controls are drawn at once; nothing else is drawn until the chart is given its tables.

A setting that is not known, or a value a setting cannot take, is refused: `biomarkerScreen` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants, outcomes }`, each an array of records, one object per row: the tables the [core](core.md) reads, as the other charts take them, and the outcomes table the [stratified survival chart](stratified-survival.md#the-tables) reads, one row per participant and endpoint with a time and a censor or event flag. Only the results table is required. Without an outcomes table the Compare control offers only a difference and a correlation, and says why: `A hazard ratio needs an outcomes table: …`. An outcomes table without a column the settings name is refused, with a message that names it. A difference needs a column of groups, which is a category column of the participant table, or one carried on the results rows. With a participant table the chart shows a filter for each of its category columns; a filter chooses participants, and the ones filtered out are not in the frame. When the filters together let nobody through, the chart draws nothing, asks R for nothing and reads `No participant passes the filters.`, the words every chart uses; loosen a filter and it draws again.

A participant table is matched to the results by the participant's id, in the column `participant_id_col` names, or `id_col`'s when that is not set. A participant table without that column is refused, with a message that names the column. A participant the results have and the participant table does not is left out and counted (`Not in the participant table`), and so is a row of results with no participant id (`Row has no participant id`). If drawing fails for any other reason, the footnote says `This chart could not be drawn:` and why, nothing half drawn is left, and the controls stay.

## The rows

One row per biomarker the Biomarker list has, in the setting `measures` or every biomarker in the table, each at the one visit with the one value type: the result, the baseline value, or the change, fold change or percent change from baseline, as the [core defines them](core.md#value_types). A baseline value has no visit. For a change, a fold change or a percent change at the one baseline visit there is nothing to compare, and the chart asks for a later visit.

| Comparison    | Each row                                                                                                                                                                                                                           | Its p-value                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `difference`  | The standardised difference between two groups, Hedges' g: the first group's mean less the second's, in pooled standard deviations, with its noncentral-t interval. gsm.bio computes it, and holds it to `effectsize::hedges_g()`. | Welch's t-test, the one the group comparison prints for that biomarker.     |
| `correlation` | Pearson's or Spearman's coefficient with one fixed variable, with its interval where R gives one; Spearman's has none in R, and none is made up.                                                                                   | `cor.test`'s, the one the association scatter prints for that pair.         |
| `hazard`      | The hazard ratio of High against Low on the endpoint, with its interval, Cox's: R cuts each biomarker at its median among the participants with a value and an outcome, a value on the median Low.                                 | The log-rank test's, the one `Analyze_Survival` gives for those two groups. |

For a hazard ratio, R cuts each biomarker itself, at its median, as `Analyze_Screen` does: no other cut is offered here. Where R does not estimate a row's hazard ratio, as when one group has no event, the row gives R's reason, `Not computed: the hazard ratio is not estimable: …`, and no number, and is left out of the adjustment.

For a difference, the interval and the p-value come from two methods: the interval is Hedges' g's, on a pooled standard deviation, and the p-value is Welch's t-test, which does not pool. They can disagree about whether a difference is distinguishable from nought. R says so in its answer, and the statistics line under the rows prints it among R's notes: `The interval is the pooled-variance (Student) interval for Hedges' g, while the p-value is Welch's, which does not pool the variances: …`

The fixed variable of a correlation is a participant-level number, such as age, or a biomarker at a visit. A biomarker that is the fixed variable itself, at the same visit with the same value type, is not a row of its own: its coefficient with itself is one, and the note above the screen says so.

Every p-value is adjusted across the rows that have one, by Benjamini-Hochberg, which keeps down the share of false leads among the rows picked out and is the usual aim of a screen, or by Holm, which guards against any false lead at all and is stricter. A row R could not compute, a group too small among them, shows R's reason and no number, and is left out of the adjustment, as R says.

### The order, and how many are shown

The rows are sorted by the setting `sort`:

| Sort       | Order                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `estimate` | By R's estimate, largest first. A difference that runs the other way is at the bottom: swap the two groups to turn the axis round. |
| `name`     | By the biomarker's name.                                                                                                           |
| `adjusted` | By R's adjusted p-value, smallest first.                                                                                           |

A row R gave no number for comes after those it did, and rows that tie keep R's order. Sorting asks R nothing.

With more rows than `limit`, twenty by default, the rows are paged: the note above them says how many it shows of how many and in what order, and Previous and Next go between the pages. Twenty rows of the screen fill a laptop's screen; a page with room for more sets `limit` higher.

## What is drawn

A heading says what the rows are: `Change from baseline at Week 4: Placebo against Treatment, standardised difference`. A caption says what each row's estimate is, at what level its interval is, which test the p-values are and by what they were adjusted across how many biomarkers: `Each row: Standardised difference (Hedges’ g), Placebo less Treatment, with its 95% confidence interval on one axis without units. p: Welch Two Sample t-test, unadjusted, and adjusted by Benjamini-Hochberg across the 12 biomarkers with a p-value. Exploratory, adjusted (Benjamini-Hochberg).`

Then one row per biomarker:

| Column              | What                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Biomarker           | Its name.                                                                                                       |
| The axis            | R's estimate as a dot and its interval as a line, on the one axis every row shares, with nought marked.         |
| Estimate (interval) | R's estimate and its interval, to four significant figures.                                                     |
| p, unadjusted       | R's p-value for the row, `p = 0.031`, or `p < 0.001`.                                                           |
| p, the adjustment   | The same, adjusted across the rows by the adjustment named in the column's heading.                             |
| n                   | The counts R used: each group's for a difference, `95 / 91`, or the number of complete pairs for a correlation. |

The axis runs symmetrically about nought for a difference, far enough to hold every interval, and from −1 to 1 for a coefficient. It has no unit: the rows share it because each estimate is in standard deviations, or is a coefficient. A hazard ratio is drawn on a logarithmic axis instead, from a half to two at least, labelled at powers of two, with 1, no difference, marked; the counts are High's and Low's.

A row is a button. Its name for a screen reader is the whole row in a sentence, from the shared formatter: `IL-6: 0.9133, 95% confidence interval 0.6111 to 1.213. Welch Two Sample t-test: p < 0.001 unadjusted, p < 0.001 adjusted across 12 biomarkers (Placebo n = 95, Treatment n = 91). Exploratory, adjusted (Benjamini-Hochberg). Open in the group comparison.`

Under the screen, the line says what R did: `Welch Two Sample t-test, one row per biomarker: 12 of 12 computed. The adjusted p-values are adjusted by Benjamini-Hochberg across the 12 biomarkers that have a p-value.`, then R's notes and warnings as R worded them, then who the screen covers. Download: CSV saves the rows in the order shown.

No star and no word such as "significant" is printed anywhere.

## The frame

The rows' variables are resolved by the [core's frame](core.md#frametables-variables-settings): one column per biomarker, named by the biomarker, none of them required, so a participant with some of the biomarkers is kept with a gap where they have none, and R counts who each row has. Beside them is the column of groups, named by its column, for a difference; the fixed variable for a correlation, named by its column or as `IL-10 at Baseline`; or, for a hazard ratio, the participant's `time` and flag, `censor` or `event` as the outcomes table reads it, for the endpoint. A participant with no outcome to use for the endpoint is kept with a gap, and R leaves them out of every row; the note above the screen counts them by reason. A participant with none of the biomarkers is left out of the frame, and counted.

The note above the screen says how many participants are in the frame of how many, and the line under it that each row is of the ones who have its biomarker.

## The chart's methods

The lifecycle is safety.viz's, so a page drives the libraries the same way. `init`, `setData`, `setSettings` and `close` return the chart, so calls can be chained.

| Method                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`              | Loads the tables and draws. The same as `setData`.                                                                                                                                                                                                                                                                                                                                                                    |
| `chart.setData(data, settings)` | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table. `settings`, when given, are laid over the chart's with the tables, for tables that need them: a participant table whose id column has another name comes with `{ participant_id_col }`. The tables are checked against those settings, so the two change together. |
| `chart.setSettings(settings)`   | Lays settings over the current ones and draws again. A setting that says what the chart opens on moves its control.                                                                                                                                                                                                                                                                                                   |
| `chart.render()`                | Draws everything again from the tables, the settings and the controls, and asks R again.                                                                                                                                                                                                                                                                                                                              |
| `chart.resize()`                | Fits a chart a row opened to its container.                                                                                                                                                                                                                                                                                                                                                                           |
| `chart.destroy()`               | Takes the chart down, with a chart a row had opened, and empties its element. A destroyed chart cannot be used again.                                                                                                                                                                                                                                                                                                 |
| `chart.statistics()`            | What the chart has asked R for the screen now drawn, and what R answered: see [what R is asked](#what-r-is-asked). It draws nothing.                                                                                                                                                                                                                                                                                  |
| `chart.open(biomarker)`         | Opens a biomarker's own chart, as a click on its row does. Returns that chart.                                                                                                                                                                                                                                                                                                                                        |
| `chart.close()`                 | Closes that chart and shows the screen again, as it was.                                                                                                                                                                                                                                                                                                                                                              |
| `chart.opened()`                | The chart a row has opened, or null while the screen is shown.                                                                                                                                                                                                                                                                                                                                                        |

Tables the chart cannot read are refused: `setData` throws a `TypeError`, and the message is shown in the chart's element.

## Settings

Every setting, with its default. The column settings and the baseline settings are the [core's](core.md#default_settings), under the same names, and a setting another chart also has is named as it is there.

| Setting               | Default            | Meaning                                                                                                                                                                   |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`              | `'USUBJID'`        | The participant's id, in the results table.                                                                                                                               |
| `measure_col`         | `'TEST'`           | The biomarker's name.                                                                                                                                                     |
| `value_col`           | `'STRESN'`         | The result.                                                                                                                                                               |
| `visit_col`           | `'VISIT'`          | The visit's name.                                                                                                                                                         |
| `visit_order_col`     | `'VISITNUM'`       | A number that orders the visits. May be null.                                                                                                                             |
| `unit_col`            | `'STRESU'`         | The unit of the result, for the charts a row opens. May be null.                                                                                                          |
| `participant_id_col`  | `null`             | The participant's id in the participant table, when it is not named as `id_col` is.                                                                                       |
| `baseline_visits`     | `null`             | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                                         |
| `baseline_stat`       | `'mean'`           | How several baseline visits are brought to one value: `mean`, `min`, `max` or `first`.                                                                                    |
| `comparison`          | `'difference'`     | What a row is: `difference`, between two groups; `correlation`, with one variable; or `hazard`, high against low on an endpoint, which needs an outcomes table.           |
| `visit`               | `null`             | The visit every biomarker is read at. Null means the first visit, as does a visit the table lacks.                                                                        |
| `value_type`          | `'raw'`            | The value type of every row: `raw`, `baseline`, `change`, `fold_change` or `percent_change`.                                                                              |
| `group_by`            | `null`             | A difference's column of groups. Null means the first category column with two groups or more.                                                                            |
| `levels`              | `null`             | A difference's two groups, first and second: the estimate is the first's mean less the second's. Null means the column's first two, in order.                             |
| `with`                | `null`             | A correlation's fixed variable: `{ col }` for a participant-level number, or `{ measure, visit, value }` for a biomarker at a visit. Null means the first number offered. |
| `method`              | `'pearson'`        | A correlation's coefficient: `pearson` or `spearman`.                                                                                                                     |
| `outcome_id_col`      | `null`             | The participant's id in the outcomes table. Null means `id_col`'s name.                                                                                                   |
| `endpoint_col`        | `'PARAMCD'`        | The endpoint, in the outcomes table.                                                                                                                                      |
| `endpoint_label_col`  | `'PARAM'`          | The endpoint in words, for the Endpoint control and the heading. May be null.                                                                                             |
| `time_col`            | `'AVAL'`           | The time to the event or to censoring.                                                                                                                                    |
| `censor_col`          | `'CNSR'`           | The censor flag, 1 for censored. Null when `event_col` is named; naming `event_col` alone sets it to null.                                                                |
| `event_col`           | `null`             | The event flag, 1 for an event, in place of `censor_col`.                                                                                                                 |
| `endpoint`            | `null`             | A hazard ratio's endpoint. Null means the first in the outcomes table.                                                                                                    |
| `adjustment`          | `'BH'`             | The adjustment across the rows, as `p.adjust` names it: `BH`, Benjamini-Hochberg, or `holm`.                                                                              |
| `sort`                | `'estimate'`       | The order of the rows: `estimate`, `name` or `adjusted`. See [the order](#the-order-and-how-many-are-shown).                                                              |
| `limit`               | `20`               | The most rows on a page, a whole number of one or more.                                                                                                                   |
| `measures`            | `null`             | The biomarkers screened, in this order. Null means every biomarker in the table, by name.                                                                                 |
| `groups`              | `null`             | The columns of groups offered, as names or `{ value_col, label }`. Null means every category column.                                                                      |
| `numbers`             | `null`             | The participant-level numbers a correlation is offered, as names or `{ value_col, label }`. Null means every numeric participant column.                                  |
| `max_levels`          | `12`               | The most different values a column may hold and still be a category column.                                                                                               |
| `filters`             | `null`             | The filters, as names or `{ value_col, label }`, with safety.viz's `start`, `all` and `multiple`. Null means every category column of the participant table.              |
| `connection`          | `null`             | The connection to R the screen asks. Null means one with no R attached.                                                                                                   |
| `statistic`           | `'Analyze_Screen'` | The R function the screen asks for: gsm.bio's, or one that takes the same arguments. Null means no rows and no Statistics controls.                                       |
| `waiting_note`        | `null`             | A sentence added to the waiting text until R has answered once: what starting R costs on this page. Null means none.                                                      |
| `group_comparison`    | `null`             | Settings for the group comparison a row of a difference opens, laid under what the screen carries across.                                                                 |
| `association_scatter` | `null`             | Settings for the association scatter a row of a correlation opens, laid under what the screen carries across.                                                             |
| `stratified_survival` | `null`             | Settings for the stratified survival chart a row of a hazard ratio opens, laid under what the screen carries across.                                                      |

There is no setting for a confidence level or a minimum group size: those are R's, at gsm.bio's defaults.

## The controls

In safety.viz's sidebar.

| Section    | Control                  | What it sets                                                                                                                      |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Screen     | Compare                  | A difference between two groups, a correlation with one variable, or, with an outcomes table, a hazard ratio of high against low. |
| Screen     | Endpoint                 | A hazard ratio's endpoint of the outcomes table.                                                                                  |
| Screen     | Value, Visit             | The value type of every row, and its visit. No Visit control for a baseline value.                                                |
| Screen     | Group by, First, Second  | A difference's column of groups and its two groups. The same group twice swaps them.                                              |
| Screen     | Correlate with, At visit | A correlation's fixed variable: a participant-level number, or a biomarker and its visit.                                         |
| Screen     | Method                   | A correlation's coefficient: Pearson or Spearman.                                                                                 |
| Statistics | Adjustment               | Benjamini-Hochberg or Holm.                                                                                                       |
| Display    | Sort                     | The order of the rows. It asks R nothing.                                                                                         |
| Filters    | one per filter           | The participants in the frame. Only with a participant table.                                                                     |
|            | Reset chart              | Returns every control to what the chart opened on.                                                                                |

## The statistics

The function is gsm.bio's `Analyze_Screen`, which calls, for each biomarker, the function the matching single chart calls, `Analyze_GroupDifference` with Welch's test or `Analyze_Correlation`, so a row's p-value is the one that chart prints for that biomarker; it computes Hedges' g beside a difference's; and it adjusts across the rows with `p.adjust`. The screen asks once, whatever the number of rows.

A row is printed through the shared formatter, [`formatScreenRow`](r-connection.md#formatscreenrowrow-groups): its estimate and interval to four significant figures, its p-values by the rules every p-value is held to, never without the method and the counts, labelled exploratory, the adjustment named.

Where no row could be computed R answers with its reason, `Not computed: every biomarker has a group below the minimum size. Each row gives its reason.`, the line prints it, and every row gives its own.

### Waiting, and never a stale answer

The two rules every chart keeps. From the moment the screen is asked for until R answers, the line reads `Statistics: waiting for R…`, with the setting `waiting_note` until R has answered once, and no rows are drawn: the chart says which biomarkers it will screen. Every time the chart is drawn the rows and the line are cleared and asked for again, and an answer that was asked for before the chart was last drawn is dropped when it arrives. A change to the comparison, the value, the visit, the groups, the variable, the method, the adjustment or a filter draws the chart again; a change to the order or the page does not, and asks R nothing.

## A row opens its chart

A click on a row, or Enter or Space on it, opens that biomarker's own chart in place of the screen, with a button back, `Back to the biomarker screen`, which takes the keyboard's place when it opens.

| Comparison    | Opens                                                   | Carried across                                                                                                                               |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `difference`  | The [group comparison](group-comparison.md)             | The biomarker, the visit, the value type, the column of groups and the two groups (`levels`), and Welch's test (`test: 't'`).                |
| `correlation` | The [association scatter](association-scatter.md)       | The biomarker along the bottom and the fixed variable up the side, and the method.                                                           |
| `hazard`      | The [stratified survival chart](stratified-survival.md) | The biomarker at the visit with the value type, cut at its median (`cut: 'median'`), the endpoint, and the outcomes table's column settings. |

Each is given the screen's connection itself, so R is started once for all of them, the filters as they are set, and the column settings. Anything else the opened chart should have is given in the setting `group_comparison`, `association_scatter` or `stratified_survival` and laid under those.

The opened chart asks R for its own statistics, as it always does. On the same rows they are the row's: the group comparison's Welch p-value is the row's unadjusted p-value, the scatter's coefficient is the row's estimate, and the survival chart's hazard ratio, the higher group's over the lower's, is the row's. The survival chart works out its median on the participants the filters keep who have a value, and R on those who also have an outcome; where every participant with a value has an outcome, as in the synthetic study, the two cuts are one.

Back to the biomarker screen takes the chart down and shows the screen again exactly as it was, on the same page, with the keyboard on the row that was opened. Nothing is drawn again and R is not asked again.

## What R is asked

For the screen, one call:

```js
connection.run('Analyze_Screen', {
  data, // the frame: the id, one column per biomarker, and the groups or the fixed variable
  args: {
    chrCols: ['CRP', 'D-dimer', 'IL-6'],
    strComparison: 'difference',
    strGroupCol: 'ARM',
    chrGroups: ['Placebo', 'Treatment'],
    strPAdjust: 'BH'
  },
  dataId // what the frame is: see below
});
```

| Argument        | Value                                                                                              | Sent for       |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| `chrCols`       | The biomarkers, the rows, in the Biomarker list's order: the names of their columns.               | every one      |
| `strComparison` | `'difference'`, `'correlation'` or `'hazard'`.                                                     | every one      |
| `strGroupCol`   | The column of groups.                                                                              | a difference   |
| `chrGroups`     | The two groups, first and second.                                                                  | a difference   |
| `strWithCol`    | The fixed variable's column: its name, or `IL-10 at Baseline` for a biomarker at a visit.          | a correlation  |
| `strCorMethod`  | `'pearson'` or `'spearman'`.                                                                       | a correlation  |
| `strTimeCol`    | `'time'`, the outcome's time.                                                                      | a hazard ratio |
| `strCensorCol`  | `'censor'`, when the outcomes table flags censoring (`censor_col`); else `strEventCol`, `'event'`. | a hazard ratio |
| `strPAdjust`    | `'BH'` or `'holm'`.                                                                                | every one      |

Nothing else is sent: the confidence level and the minimum group size are gsm.bio's defaults. In `data` a value a participant does not have is null, which R reads as missing.

`dataId` states what the frame is. A [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together:

| Member            | Value                                                                                                                 | Left out when         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `chart`           | `'biomarker-screen'`.                                                                                                 | never                 |
| `value_type`      | The value type.                                                                                                       | never                 |
| `visit`           | The visit.                                                                                                            | a baseline value      |
| `baseline_visits` | The setting, as a list.                                                                                               | the setting is null   |
| `baseline_stat`   | The setting.                                                                                                          | never                 |
| `with`            | A correlation's fixed variable, as the settings write a variable: `{ measure, value, visit }`, or `{ col }`.          | not a correlation     |
| `endpoint`        | A hazard ratio's endpoint.                                                                                            | not a hazard ratio    |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point. | no filter is in force |

A member that is not set is left out, never written as null.

`chart.statistics()` returns what the chart has asked for the screen now drawn: one entry, `{ name, args, dataId, rows, answer }`, where `rows` is the number of rows in the frame and `answer` is what the connection resolved to, or null while R has not answered.

### Stored results, from R

A page that ships R's answers gives the chart a connection with `results`: one stored result for each screen it computed, and, for a row it opens, the group comparison's or the association scatter's own [stored results](group-comparison.md#stored-results-from-r) for that biomarker, since the chart a row opens asks through the same connection. A view with no stored result reads `Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.`, and no rows are drawn.

In R, the key of one screen's stored result, from the frame and what the view is set to:

```r
# dfFrame: the frame, one row per participant: the id, one numeric column per
#          biomarker of the screen, named by the biomarker, NA where the
#          participant has no value; and the column of groups, or the fixed
#          variable under with_name.
# lView:   the view, by the chart's names; a member that is not set is NULL.

# A value as the chart writes it into the identity: as text, the way
# JavaScript's String() writes it. TRUE and FALSE are "true" and "false". A
# number is written in the fewest digits that read back as the same number,
# whole up to 1e21 and in full down to 1e-6, and with an exponent outside that
# (1e-7, 1e+21), as JavaScript does. So a panel column holding the number 2 is
# written "2", and NaN "NaN". The text is JavaScript's for every number that
# needs 13 significant digits or fewer. Beyond that R's reading of a number,
# which the search for the fewest digits relies on, is not always exact, and
# the text can take more digits than JavaScript's.
chart_text <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.logical(x)) return(ifelse(x, "true", "false"))
  if (is.numeric(x)) return(vapply(x, chart_number, character(1)))
  as.character(x)
}

chart_number <- function(value) {
  if (is.nan(value)) return("NaN")
  if (is.na(value)) return(NA_character_)
  if (value == 0) return("0")
  if (is.infinite(value)) return(if (value > 0) "Infinity" else "-Infinity")
  # The fewest significant digits that read back as the same number.
  for (precision in 1:17) {
    written <- sprintf("%.*e", precision - 1L, abs(value))
    if (as.numeric(written) == abs(value)) break
  }
  digits <- sub("0+$", "", gsub(".", "", sub("e.*$", "", written), fixed = TRUE))
  k <- nchar(digits)
  n <- as.integer(sub("^.*e", "", written)) + 1L
  text <- if (k <= n && n <= 21) {
    paste0(digits, strrep("0", n - k))
  } else if (n > 0 && n <= 21) {
    paste0(substr(digits, 1, n), ".", substr(digits, n + 1, k))
  } else if (n > -6 && n <= 0) {
    paste0("0.", strrep("0", -n), digits)
  } else {
    paste0(substr(digits, 1, 1), if (k > 1) paste0(".", substr(digits, 2, k)) else "",
           "e", if (n - 1 >= 0) "+" else "-", abs(n - 1))
  }
  if (value < 0) paste0("-", text) else text
}

# A member of the identity that is not set is left out, never written as null.
# A member that is a list of values is an unnamed list, so it is written as a
# JSON array whatever its length. Text is sorted by code point
# (`method = "radix"`), which is the order the chart sorts in.
biomarker_screen_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "biomarker-screen", value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- chart_text(lView$visit)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (identical(lView$comparison, "correlation")) lDataId$with <- lapply(lView$with, chart_text)
  if (identical(lView$comparison, "hazard")) lDataId$endpoint <- chart_text(lView$endpoint)
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  lArgs <- list(chrCols = as.list(chart_text(lView$biomarkers)), strComparison = lView$comparison)
  if (identical(lView$comparison, "difference")) {
    lArgs$strGroupCol <- lView$group_by
    lArgs$chrGroups <- as.list(chart_text(lView$groups))
  } else if (identical(lView$comparison, "hazard")) {
    # Each biomarker is cut at its median by Analyze_Screen itself; the frame
    # holds the time and the flag, censored or event, as the table reads it.
    lArgs$strTimeCol <- "time"
    if (identical(lView$flag, "event")) lArgs$strEventCol <- "event" else lArgs$strCensorCol <- "censor"
  } else {
    lArgs$strWithCol <- lView$with_name
    lArgs$strCorMethod <- lView$method
  }
  lArgs$strPAdjust <- lView$adjustment
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfFrame))
}

lKey <- biomarker_screen_key(dfFrame, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfFrame), lKey$args))))
```

The frame holds the participants who have at least one of the biomarkers, after the filters; `rows` is how many they are. Written to JSON, a single value is a single value and an unnamed list is an array (`jsonlite::toJSON(auto_unbox = TRUE)`), and the value is in [the shape the browser form gives](r-connection.md#stored-results).

This is the function `tools/r-screen-statistics.R` writes the chart's expected results with. The unit tests named `BS-STAT-009` hold the key it writes, for ten views of the gallery's demo, to the key the chart asks with, and hold the copy here to the script's.

### In the browser

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, as the connection's `browser.sourceUrl`; the screen's difference and correlation rows need base R alone, so a page that draws only this chart installs no package. Nothing is fetched until the screen first asks.

The answers are checked against desktop R. `tools/r-screen-statistics.R` sources the same vendored file in desktop R, runs it on frames the chart's own code wrote, and writes `tests/fixtures/screen-statistics-r.json` with the R version that made it. The browser tests named `BS-LIVE-*` run the gallery's chart against real R in the browser and hold every row's estimate, interval, p-values and counts to that file within 1 part in 10^8, for both comparisons and both adjustments.

## On a phone

Below 900 pixels of width safety.viz's shell stacks, and below 600 the controls start folded away, one tap from open. Each row stacks: the biomarker's name, then its interval on the full width of the axis, then its numbers, each with its name before it, `Unadjusted: p < 0.001`. The page never scrolls sideways.

## What is not here

No estimate, interval, p-value or adjustment is computed here, and the rows are not reordered by anything R did not return. The chart works out which biomarkers are rows, where a dot and a line sit along the axis for the numbers R returned, and which rows are on a page.
