# The library core

What a page or a widget can rely on before it asks for a chart: where the bundles are, what they define and the version they report; and the two steps every chart shares before anything is drawn, exported as `BioViz.core`: a variable named one way, and named variables resolved to one row per participant. The charts and the connection to R each have a reference of their own.

## Loading the library

The bundles are committed, so a page needs no build step and no package manager. Copy the folder `dist/bio.viz-0.2.0/` and load the script-tag bundle; it defines one global, `BioViz`:

```html
<script src="dist/bio.viz-0.2.0/bio.viz.js"></script>
<script>
  console.log(BioViz.version); // "0.2.0"
</script>
```

An ES module bundle with the same exports sits beside it:

```js
import { version, core, r } from './dist/bio.viz-0.2.0/bio.viz.esm.js';
```

| File                                | What it is                                                |
| ----------------------------------- | --------------------------------------------------------- |
| `dist/bio.viz-0.2.0/bio.viz.js`     | The script-tag bundle. Defines the global `BioViz`.       |
| `dist/bio.viz-0.2.0/bio.viz.esm.js` | The ES module bundle. The same exports, as named exports. |
| `*.map`                             | A source map for each, so a debugger shows the source.    |

Nothing else is bundled into either file. safety.viz and R are loaded beside bio.viz on a page: safety.viz with its own script tag, and R the first time a statistic is asked for.

## `version`

A string: the version of the library, `0.2.0`. It equals the `version` field of `package.json` and is fixed when the bundle is built, so it says which build a page loaded. The folder the bundle sits in carries the same number.

## A variable

A variable is what goes on an axis, makes a group, a colour or a panel. It is written one way wherever a chart takes one, and it is one of two things:

```js
// a biomarker at a visit, with a value type
const y = { measure: 'IL-6', visit: 'Week 4', value: 'change' };

// a column
const x = { col: 'ARM' };
```

The biomarker and the visit are written as the results table writes them (`IL-6`, `TNF-alpha`, `Week 4`); nothing is assumed about what a name may contain. Which column holds the biomarker's name, the visit and the result is a [setting](#default_settings).

## `variable(spec)`

Checks a variable and returns it in full, frozen. A chart calls it where the variable is written, so a mistake is found there and not in an empty chart.

| Key       | For         | Meaning                                                                                                                                                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `measure` | a biomarker | The biomarker's name, as the results table writes it.                                                                                                                                                        |
| `visit`   | a biomarker | The visit's name, as the results table writes it. Required, except with the value type `baseline`, which takes none.                                                                                         |
| `value`   | a biomarker | The [value type](#value_types). `raw` when not given.                                                                                                                                                        |
| `col`     | a column    | The column's name.                                                                                                                                                                                           |
| `type`    | a column    | `'number'` to read the column as a number. Without it the value is passed on as the table holds it.                                                                                                          |
| `cut`     | either      | To cut the number into groups: `'median'`, `'tertiles'`, `'quartiles'`, or the cut points as a list, ascending. A column cut must be read as a number (`type: 'number'`). See [the cut rule](#the-cut-rule). |

It returns `{ kind: 'measure', measure, visit, value }` or `{ kind: 'column', col, type }`, with `visit` and `type` null where they do not apply, and `cut` when the variable has one (typed points as a frozen copy). A variable it returned can be handed back to it.

A malformed variable is refused: `variable` throws a `TypeError` whose message begins `bio.viz:`, quotes the variable as written and names what is wrong. It refuses a variable that:

- is not an object;
- names neither a biomarker nor a column, or names both;
- has an empty `measure` or `col`, or one that is not text;
- has a `value` that is not one of the five value types;
- is a biomarker with no `visit`, or a baseline value with one;
- is a column with a `visit` or a `value`, or with a `type` other than `'number'`;
- has a key that is not in the table above;
- has a `cut` that is not one of [`CUTS`](#cuts) or a list of cut points: an empty list, a point that is not a finite number, or points that are not each greater than the one before;
- cuts a column that is not read as a number.

## The cut rule

One rule cuts a number into groups, the same in every chart that makes groups from one and the same in R. A variable carries the cut it asks for:

```js
{ measure: 'CRP', visit: 'Baseline', cut: 'median' }   // two groups
{ measure: 'CRP', visit: 'Baseline', cut: 'tertiles' } // three
{ measure: 'CRP', value: 'baseline', cut: 'quartiles' } // four
{ col: 'AGE', type: 'number', cut: [40, 60] }           // typed points: three groups
```

- The values cut are the variable's, one per participant, for the participants the chart's filters keep. A participant with no value is left out of the points and is in no group. The [frame](#frametables-variables-settings) resolves a cut variable to its number like any other; the cut is a step after it, across participants.
- The cut points are R's `quantile()` with its default, type 7, at 1/2 (the median), 1/3 and 2/3 (the tertiles) or 1/4, 2/4 and 3/4 (the quartiles). Typed points are used as written.
- A participant is in the group R's `cut(x, breaks = c(-Inf, points, Inf), right = TRUE)` puts them in: a value equal to a cut point falls in the lower group.
- A point that repeats, as one does when many values are tied, collapses: the median of a cut always makes two groups, but quartiles of tied values may make fewer than four. The chart says so.
- The groups are ordered low to high and labelled with their bounds: `≤ a` for the first, `> a, ≤ b` for each between, `> z` for the last. A bound is written to four significant digits, as R's `format(signif(p, 4), scientific = FALSE, trim = TRUE)` writes it: 2.783, 0.5833, 123500, and 2.0625 as 2.062, because R rounds a tie to even. However small or large, a bound is written in full with no trailing zero: 0.000000000000000111, 0.0000001, and 3382000000000000000000; a whole number past 2^53 is written to the last digit of the double that holds it, as R writes one. This holds from about 1e-300 to 1e300. Beyond that the label can differ from R's: below about 2.2e-308 R writes scientific notation, and above about 1e306 the digits differ ([#60](https://github.com/jwildfire/bio.viz/issues/60)). A value that is not a finite number, an infinite one among them, is missing here; R's `quantile()` keeps an infinite value.
- Two points that differ only past four significant digits write the same bounds, so the groups between them have the same label. Those groups are one, and the chart says so. In R that is the recipe in `tools/r-cut.R`: R's `cut()` given those labels merges the levels that share one. R's `cut()` with its own labels would instead write more digits until the labels differ. Typed points written alike are refused, because the groups they ask for could not be told apart.
- A cut point describes the values, as the median line of a box does. Nothing here tests, estimates or compares.

The same groups in R, for gsm.bio or anyone checking a chart (`tools/r-cut.R` writes the expected results the unit tests hold this library to, with exactly these lines):

```r
CUT_PROBS <- list(median = 0.5, tertiles = c(1, 2) / 3, quartiles = c(1, 2, 3) / 4)

cut_bound <- function(p) format(signif(p, 4), scientific = FALSE, trim = TRUE)

bound_labels <- function(points) {
  k <- length(points)
  if (k == 0) return(character(0))
  bounds <- vapply(points, cut_bound, character(1))
  middle <- if (k > 1) paste0("> ", bounds[-k], ", ≤ ", bounds[-1]) else character(0)
  c(paste0("≤ ", bounds[1]), middle, paste0("> ", bounds[k]))
}

cut_labels <- function(points) unique(bound_labels(points))

cut_points <- function(x, cut) {
  asked <- if (is.character(cut)) {
    stats::quantile(x, CUT_PROBS[[cut]], type = 7, na.rm = TRUE, names = FALSE)
  } else {
    cut
  }
  list(asked = asked, points = unique(asked))
}

cut_groups <- function(x, points) {
  as.character(cut(x, breaks = c(-Inf, points, Inf), right = TRUE, labels = bound_labels(points)))
}
```

A label holds the sign ≤ (U+2264), so R must run in a UTF-8 locale. Where a chart writes a cut variable into the identity of the rows it hands R, it writes it as the settings do, `{ measure, visit, value, cut }` with the visit left out for a baseline value, or `{ col, type: 'number', cut }`; typed points are always a list, so in R write them as one (`I(c(2, 5))` or `list(2, 5)` for jsonlite), even a single point. jsonlite writes a number to four decimal places unless told otherwise, so write the identity with `digits = NA` too, which writes 15 significant digits, enough for a point typed with 15 or fewer: with the default, a typed point of 0.000012345 is written 0, and the key does not match.

## `CUTS`

The cuts a variable may name, as a list: `median`, `tertiles`, `quartiles`. Typed points are a list of numbers instead.

## `cutPoints(values, cut)`

The cut points of a variable's values, and the groups they make. `values` holds one value per participant; one that is not a finite number is missing and is left out. `cut` is one of `CUTS` or the typed points. It returns:

| Field      | What it is                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `cut`      | The cut, as given.                                                                               |
| `n`        | How many values it was worked out on.                                                            |
| `asked`    | The points asked for: R's `quantile()` of the values, or the typed points.                       |
| `points`   | The points used: `asked` with a repeated point once.                                             |
| `repeated` | Whether a point repeated and collapsed.                                                          |
| `merged`   | Whether points written alike gave groups the same label, which merged.                           |
| `labels`   | The label of each group, low to high: one more than there are points, fewer where groups merged. |

With no value there is nothing to cut at: no points and no groups.

## `cutGroup(value, points)`

The group a value falls in, counted from 0, low to high, as R's `cut(right = TRUE)` places it, so a value equal to a cut point is in the group below it, and its place among the `labels` of the cut, so groups that merged are one. Null for a missing value. `points` are a cut's `points`.

## `cutLabels(points)`

The labels of the groups a cut's `points` make, low to high, as above: `cutLabels([2, 5])` is `['≤ 2', '> 2, ≤ 5', '> 5']`. A label that repeats is given once: `cutLabels([2.7928, 2.793, 2.7932])` is `['≤ 2.793', '> 2.793, ≤ 2.793', '> 2.793']`.

## `cutWords(cut)`

A cut in words, for a label or a legend: `cut at the median`, `cut at the tertiles`, `cut at 2 and 5`. [`label`](#labelspec) adds it after the variable: `CRP at Baseline, cut at the median`.

## `VALUE_TYPES`

The five value types, as a list: `raw`, `baseline`, `change`, `fold_change`, `percent_change`. Each is worked out for one participant from that participant's own results for the biomarker.

| Value type       | What it is                                         | Not worked out when                                     |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `raw`            | The result at the visit.                           | There is no usable result at the visit.                 |
| `baseline`       | The baseline: the result at the baseline visits.   | There is no usable result at any baseline visit.        |
| `change`         | The result at the visit minus the baseline.        | Either is missing.                                      |
| `fold_change`    | The result at the visit divided by the baseline.   | Either is missing, or the baseline is zero or negative. |
| `percent_change` | 100 × (result at the visit − baseline) ÷ baseline. | Either is missing, or the baseline is zero or negative. |

The terms, exactly:

- A usable result is a finite number, or text that reads as one (a table read from a CSV file holds its numbers as text, and `' 7 '` is 7). An empty cell, `NA`, `<0.5` and anything else is not a result.
- The result at a visit is the first usable result, in the table's order, among the participant's rows for that biomarker and visit. A later one is not used, and is [counted](#unused).
- The baseline visits are the ones named in the setting `baseline_visits`. When none is named, the baseline visit is the first visit in [visit order](#visitsresults-settings). Only visits with a usable result are considered.
- With one baseline visit, the baseline is the result there. With several, one result is taken per baseline visit that has one, and they are brought to one value by the setting `baseline_stat`: their mean by default. A participant with a result at only some of the baseline visits has a baseline from those.
- A fold change of 1 is no change and a percent change of 0 is no change; a fold change of 1.5 is a percent change of 50. A result of zero at the visit over a positive baseline is a fold change of 0 and a percent change of −100.
- A baseline of zero has no ratio. A negative baseline has one by arithmetic, and it is not computed: a fold or a percent change from below zero does not mean what its name says. A participant with either is dropped and counted, under its own reason. `change` is a difference and is computed whatever the sign.

This follows safety.viz's shift plot, which names its baseline visits the same way and brings several to one value with the same statistics. It differs in three places: the shift plot has no fold change; it computes a percent change from a negative baseline, where this does not; and its `first` is the first row in the table, where here it is the first baseline visit as named in settings.

## `frame(tables, variables, settings)`

Resolves named variables to one row per participant.

```js
const { data, dropped } = BioViz.core.frame(
  { results, participants },
  {
    y: { measure: 'IL-6', visit: 'Week 4', value: 'change' },
    x: { col: 'ARM' }
  },
  { baseline_visits: ['Baseline'] }
);
// data:    [{ USUBJID: 'BIO-001', y: -1.027, x: 'Placebo' }, …]   186 records
// dropped: [{ reason: 'No result at the visit', variable: 'y', n: 13 },
//           { reason: 'Result at the visit is missing or not a number', variable: 'y', n: 1 }]
```

| Argument    | Meaning                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tables`    | `{ results, participants }`. Each is an array of records, one object per row. `results` is required; `participants` may be left out.              |
| `variables` | The variables, each under the name its field is to have. The name is the caller's: `y`, `x`, `panel`, or anything else that is not the id column. |
| `settings`  | Column names and how the baseline is found: see [`DEFAULT_SETTINGS`](#default_settings). May be left out.                                         |

It returns:

| Member            | Meaning                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `data`            | One record per participant: the participant's id under the name of the id column, and one field per variable. Nothing else. |
| `id_col`          | The name of the id field in `data`.                                                                                         |
| `variables`       | The variables in full, by name, as `variable` returns them.                                                                 |
| `participants`    | How many participants were seen. It equals the records in `data` plus the counts in `dropped`.                              |
| `dropped`         | Participants who are not in `data`, counted: a list of `{ reason, variable, n }`. See [`DROPPED`](#dropped).                |
| `unused`          | Rows that were read and not used, counted: a list of `{ reason, table, n }`. See [`UNUSED`](#unused).                       |
| `baseline_visits` | The baseline visits that were used, or null when no variable needed a baseline.                                             |

### The tables

Only the results table is required. It has one record per participant, biomarker and visit, and needs the id column always, and the biomarker, visit and result columns when a variable is a biomarker.

A column variable is read from the participant table when that table is given and has the column. Otherwise it is read from the results rows, where a participant's rows must agree: the column holds one value for the participant, and an empty cell beside a filled one counts as that one value. A participant whose rows hold more than one value is dropped and counted. A column that neither table has is refused.

A wide table, with one row per participant and a column per variable, needs no special handling. Give it as `results`, or as `participants` beside a long results table, and name its columns as column variables:

```js
BioViz.core.frame(
  { results: wide },
  { y: { col: 'IL6_WEEK4', type: 'number' }, x: { col: 'ARM' } }
);
```

### Who is in the frame

With a participant table given, it says who the participants are, and in what order: one record per participant in it. A participant who has results and is not in the participant table is left out and counted. A participant who is in it and has no results is dropped, and counted, for any biomarker variable. A second row for the same participant in the participant table is not used, and a row of either table with no id is not used; both are counted in `unused`.

With no participant table, the participants are everyone with a row of results, in the order first seen.

A participant is dropped when a variable cannot be worked out for them, and is counted once, under the first such variable in the order the variables were given. So `data.length` plus the counts in `dropped` is always `participants`.

By default every variable is required. The setting `required` names the ones that are; a variable not named there is left as `null` in a participant's record, which R reads as missing, instead of dropping the participant. `required: []` keeps everyone. This is for a chart that compares many variables in pairs and must keep a participant who lacks one of them.

### What it refuses

`frame` throws a `TypeError` whose message begins `bio.viz:` when the call cannot be made: tables that are not arrays of records, a table other than the two, variables not given by name, a variable named as the id column is, a malformed variable, a setting that is not known or has a value it cannot take, a column a setting names that the table does not have, or a column variable whose column is in neither table.

It does not refuse on what the tables hold. A biomarker or a visit that no row has gives an empty `data` and a count of everyone under `No result at the visit`.

It changes nothing it is given.

## `visits(results, settings)`

The visits of a results table, in visit order, as a list of names. Only visits with at least one usable result are listed. A chart offers these in its visit control, and the first of them is the baseline visit when `baseline_visits` names none.

Visit order is one order, whatever order the rows come in:

- With a visit-order column, the visits that have a number in it come first, by number. A visit numbered on several rows takes its least number.
- Then come the visits with no number in that column.
- Visits with the same number, the visits with no number, and every visit when the table has no visit-order column are ordered by name, with numbers inside a name counted as numbers, so `Week 2` comes before `Week 12`.

So visits Screening (−1), Baseline (0), Day 1 (no number) and Week 4 (4) are in the order Screening, Baseline, Week 4, Day 1.

```js
BioViz.core.visits(results); // ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12']
```

`results` is the results table and `settings` the same settings `frame` takes; only the column names are read.

## `DEFAULT_SETTINGS`

The settings and their defaults. The names are safety.viz's, so one column mapping drives both libraries, and the defaults are the columns of the synthetic study.

| Setting              | Default      | Meaning                                                                                                                                              |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`  | The participant's id, in the results table. Also the name of the id field in the frame.                                                              |
| `measure_col`        | `'TEST'`     | The biomarker's name.                                                                                                                                |
| `value_col`          | `'STRESN'`   | The result.                                                                                                                                          |
| `visit_col`          | `'VISIT'`    | The visit's name.                                                                                                                                    |
| `visit_order_col`    | `'VISITNUM'` | A number that orders the visits ([visit order](#visitsresults-settings)), and so finds the first visit when no baseline visit is named. May be null. |
| `participant_id_col` | `null`       | The participant's id in the participant table, when it is not named as `id_col` is.                                                                  |
| `baseline_visits`    | `null`       | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                    |
| `baseline_stat`      | `'mean'`     | How several baseline visits are brought to one value: one of [`BASELINE_STATS`](#baseline_stats).                                                    |
| `required`           | `null`       | The names of the variables a participant must have to be in the frame. Null means all of them.                                                       |

## `BASELINE_STATS`

How several baseline visits are brought to one baseline value: `mean`, `min`, `max` or `first`. `first` is the first baseline visit, in the order they are named in settings, at which the participant has a result. With one baseline visit they all give that visit's result.

## `DROPPED`

The reasons a participant is not in the frame. Each entry of the frame's `dropped` list is `{ reason, variable, n }`: one of these sentences, the name of the variable that could not be worked out, and how many participants. Only reasons that dropped someone are listed, in the order of the variables and then of this table.

| Key                        | `reason`                                             | When                                                                                 |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NOT_IN_PARTICIPANT_TABLE` | `Not in the participant table`                       | The participant has results and is not in the participant table. `variable` is null. |
| `NO_RESULT`                | `No result at the visit`                             | No row for the biomarker at the visit.                                               |
| `MISSING_RESULT`           | `Result at the visit is missing or not a number`     | There are rows, and none has a usable result.                                        |
| `NO_BASELINE`              | `No baseline result`                                 | No row for the biomarker at any baseline visit.                                      |
| `MISSING_BASELINE`         | `Baseline result is missing or not a number`         | There are baseline rows, and none has a usable result.                               |
| `ZERO_BASELINE`            | `Baseline is zero`                                   | A fold or percent change was asked for.                                              |
| `NEGATIVE_BASELINE`        | `Baseline is negative`                               | A fold or percent change was asked for.                                              |
| `EMPTY_COLUMN`             | `Column is empty`                                    | The column has nothing for the participant.                                          |
| `VARYING_COLUMN`           | `Column has more than one value for the participant` | A column read from the results rows, where the participant's rows disagree.          |
| `NOT_A_NUMBER`             | `Column value is not a number`                       | A column read as a number.                                                           |

For a change, a fold change or a percent change, the visit is looked at before the baseline: a participant missing both is counted under the visit.

## `UNUSED`

The reasons a row was read and not used. Each entry of the frame's `unused` list is `{ reason, table, n }`: one of these sentences, `results` or `participants`, and how many rows. These count rows, not participants: a participant whose first result was used is in the frame however many later ones were not.

| Key                     | `reason`                                                       | When                                                                        |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `NO_ID`                 | `Row has no participant id`                                    | Either table.                                                               |
| `DUPLICATE_PARTICIPANT` | `Later row for a participant already in the participant table` | The participant table. The first row is the one used.                       |
| `DUPLICATE_RESULT`      | `Later result for the same participant, biomarker and visit`   | A usable result after the first, at a biomarker and visit a variable reads. |
| `MISSING_RESULT`        | `Result is missing or not a number`                            | A row with no usable result, at a biomarker and visit a variable reads.     |

Only the biomarkers and visits the variables read are counted: a duplicate at a visit no variable asked for is not looked at.

## `label(spec)`

A variable in words, for an axis title or a legend. `spec` is a variable as written or as `variable` returned it.

| Variable                                                | Label                                  |
| ------------------------------------------------------- | -------------------------------------- |
| `{ col: 'ARM' }`                                        | `ARM`                                  |
| `{ measure: 'IL-6', visit: 'Week 4' }`                  | `IL-6 at Week 4`                       |
| `{ measure: 'IL-6', value: 'baseline' }`                | `IL-6 at baseline`                     |
| `{ measure: 'IL-6', visit: 'Week 4', value: 'change' }` | `IL-6 at Week 4, change from baseline` |

`fold_change` and `percent_change` read the same way: `IL-6 at Week 4, fold change from baseline`.

## Handing the frame to R

`data` is what a chart draws, and it is what goes to R as the table of a statistics call: plain records of text and finite numbers, which the [connection to R](r-connection.md) turns into a data frame with one column per field. The fields are named as the variables were, and gsm.bio's statistics functions take a table and the names of its columns, so the names pass straight through:

```js
const { data } = BioViz.core.frame({ results, participants }, { y, x }, settings);
const result = await connection.run('Analyze_GroupDifference', {
  data,
  args: { strValueCol: 'y', strGroupCol: 'x', strMethod: 'wilcoxon' }
});
```

A field's name is the name the caller gave its variable, so it is stable whatever the biomarker is called, and two variables on the same biomarker are told apart by their names: `{ week4: { measure: 'IL-6', visit: 'Week 4' }, change: { measure: 'IL-6', visit: 'Week 4', value: 'change' } }`. R takes any name as a column name here; a short plain one (`y`, `x`, `v1`) is easiest to read in R's messages.

## `portfolio`

The chart list: an object naming every chart the library offers, in [safety.viz's portfolio manifest format](https://github.com/jwildfire/safety.viz/blob/dev/src/data/schema/portfolio.json), version 2, so safety.viz's demo app can list bio.viz's charts and draw them beside its own on the files a study already has. It is `src/data/portfolio.json`, and the site publishes the same list at `portfolio.json`, with the format beside it at `schema/portfolio.json`.

One chart is not in it: the [stratified survival chart](stratified-survival.md) reads an outcomes table, which no standard domain of the format holds, so the app could not hand it one ([#63](https://github.com/jwildfire/bio.viz/issues/63)).

```js
BioViz.portfolio.version; // 2
Object.keys(BioViz.portfolio.modules);
// ['group-comparison', 'association-scatter', 'correlation-matrix', 'biomarker-screen', 'cross-tab']
```

| Field                        | What it says                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                    | `2`, the format's version.                                                                                                                                                                                                                                                    |
| `groups`                     | One group, `biomarkers`, labelled Biomarkers: the app lists the charts under it, on a tab of their own.                                                                                                                                                                       |
| `modules`                    | One entry per chart, keyed by its name: `export`, the factory's name on `BioViz`; `title`; `library`, `bio.viz`; and `group`, `biomarkers`.                                                                                                                                   |
| `modules.*.tables`           | The tables `init` takes: `results`, from the labs and vitals domain (`bds`), required; and `participants`, from the subject-level domain (`subject`), optional. They are also the entry's `domains` and `optionalDomains`.                                                    |
| `modules.*.settings`         | Each column setting of the chart, keyed as in its settings: the domain it reads, the standard column it defaults to (`null` where the chart has no default) and whether the chart cannot be made without it. `participant_id_col` reads the subject-level domain's `USUBJID`. |
| `modules.*.unmappedSettings` | `omit`: a setting with no column mapped is left out, so the chart keeps its default, because a chart refuses `null` for the columns it needs.                                                                                                                                 |

The participant is named once in each file. `id_col` reads it from the results and `participant_id_col` from the participant table, so when the two files call it differently the app maps each file's own name and the charts join the two on them. Left out, `participant_id_col` is `id_col`'s name, as in every chart.

The list adds nothing to the format, and the format is safety.viz's: it is copied to `src/data/schema/portfolio.json` by `node tools/vendor-portfolio-schema.mjs`, with a record of the commit, and a test validates the list against the copy and holds each entry to its chart's own settings.

## What is not here

No statistics. Deriving a change from baseline is arithmetic on one participant's own results, and a cut point is a description of the values, as a median is. Nothing in the core tests, estimates or compares: a median and the quartiles of a box belong to the chart that draws them, and every test to R.

## What else is exported

| Export | What it is                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| `r`    | The connection to R and the rule for printing a p-value. Its reference is [the connection to R](r-connection.md). |
| `core` | The variable and the frame, described above.                                                                      |
