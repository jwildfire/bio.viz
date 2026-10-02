# The library core

What a page or a widget can rely on before it asks for a chart: where the bundles are, what they define and the version they report; and the two steps every chart shares before anything is drawn, exported as `BioViz.core`: a variable named one way, and named variables resolved to one row per participant. The charts and the connection to R each have a reference of their own.

## Loading the library

The bundles are committed, so a page needs no build step and no package manager. Copy the folder `dist/bio.viz-0.1.0/` and load the script-tag bundle; it defines one global, `BioViz`:

```html
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  console.log(BioViz.version); // "0.1.0"
</script>
```

An ES module bundle with the same exports sits beside it:

```js
import { version, core, r } from './dist/bio.viz-0.1.0/bio.viz.esm.js';
```

| File                                | What it is                                                |
| ----------------------------------- | --------------------------------------------------------- |
| `dist/bio.viz-0.1.0/bio.viz.js`     | The script-tag bundle. Defines the global `BioViz`.       |
| `dist/bio.viz-0.1.0/bio.viz.esm.js` | The ES module bundle. The same exports, as named exports. |
| `*.map`                             | A source map for each, so a debugger shows the source.    |

Nothing else is bundled into either file. safety.viz and R are loaded beside bio.viz on a page: safety.viz with its own script tag, and R the first time a statistic is asked for.

## `version`

A string: the version of the library, `0.1.0`. It equals the `version` field of `package.json` and is fixed when the bundle is built, so it says which build a page loaded. The folder the bundle sits in carries the same number.

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

| Key       | For         | Meaning                                                                                                              |
| --------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `measure` | a biomarker | The biomarker's name, as the results table writes it.                                                                |
| `visit`   | a biomarker | The visit's name, as the results table writes it. Required, except with the value type `baseline`, which takes none. |
| `value`   | a biomarker | The [value type](#value_types). `raw` when not given.                                                                |
| `col`     | a column    | The column's name.                                                                                                   |
| `type`    | a column    | `'number'` to read the column as a number. Without it the value is passed on as the table holds it.                  |

It returns `{ kind: 'measure', measure, visit, value }` or `{ kind: 'column', col, type }`, with `visit` and `type` null where they do not apply. A variable it returned can be handed back to it.

A malformed variable is refused: `variable` throws a `TypeError` whose message begins `bio.viz:`, quotes the variable as written and names what is wrong. It refuses a variable that:

- is not an object;
- names neither a biomarker nor a column, or names both;
- has an empty `measure` or `col`, or one that is not text;
- has a `value` that is not one of the five value types;
- is a biomarker with no `visit`, or a baseline value with one;
- is a column with a `visit` or a `value`, or with a `type` other than `'number'`;
- has a key that is not in the table above;
- asks for a cut (`cut: 'median'`). The rule that cuts a continuous variable into groups is not available yet: it arrives with cross-tabulation. Until then a group comes from a column.

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
- The baseline visits are the ones named in the setting `baseline_visits`. When none is named, the baseline visit is the first visit in visit order: by the visit-order column when the table has one, and otherwise by name, with numbers inside a name counted as numbers. Only visits with a usable result are considered.
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

## `DEFAULT_SETTINGS`

The settings and their defaults. The names are safety.viz's, so one column mapping drives both libraries, and the defaults are the columns of the synthetic study.

| Setting              | Default      | Meaning                                                                                                          |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`  | The participant's id, in the results table. Also the name of the id field in the frame.                          |
| `measure_col`        | `'TEST'`     | The biomarker's name.                                                                                            |
| `value_col`          | `'STRESN'`   | The result.                                                                                                      |
| `visit_col`          | `'VISIT'`    | The visit's name.                                                                                                |
| `visit_order_col`    | `'VISITNUM'` | A number that orders the visits. Used only to find the first visit when no baseline visit is named. May be null. |
| `participant_id_col` | `null`       | The participant's id in the participant table, when it is not named as `id_col` is.                              |
| `baseline_visits`    | `null`       | The baseline visit, or a list of them. Null means the first visit in visit order.                                |
| `baseline_stat`      | `'mean'`     | How several baseline visits are brought to one value: one of [`BASELINE_STATS`](#baseline_stats).                |
| `required`           | `null`       | The names of the variables a participant must have to be in the frame. Null means all of them.                   |

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

## What is not here

No statistics. Deriving a change from baseline is arithmetic on one participant's own results. Nothing in the core tests, estimates or summarises across participants: a median and the quartiles of a box belong to the chart that draws them, and every test to R. And no cut rule: see `variable` above.

## What else is exported

| Export | What it is                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| `r`    | The connection to R and the rule for printing a p-value. Its reference is [the connection to R](r-connection.md). |
| `core` | The variable and the frame, described above.                                                                      |
