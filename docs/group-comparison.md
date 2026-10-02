# The group comparison chart

Does this biomarker differ between these groups? The chart draws one value across the levels of a category at chosen visits, as boxes, violins or points, with the number in each group beneath. It takes a second grouping by colour, panels by one further variable and a logarithmic scale. Clicking a box or a point lists its participants, and a row of the list opens the participant's profile.

It draws; it does not test. The line under the chart is where a test of the groups is printed, and that test is computed by R: the chart chooses which test to ask for, hands R the rows it drew through the [connection to R](r-connection.md), and prints what R returns. With no R attached the line says that statistics are unavailable.

## At a glance

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  const chart = BioViz.groupComparison('#chart', {
    start_value: 'IL-6',
    visits: 'Week 4',
    value_type: 'change',
    baseline_visits: 'Baseline',
    group_by: 'ARM',
    // R, started in the browser the first time a test is asked for. Leave it
    // out and the line under the chart says that statistics are unavailable.
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R' }
    })
  }).init({ results, participants });
</script>
```

## What the page loads

Two script tags, safety.viz's first. The chart is built from safety.viz's kit (`SafetyViz.kit`): its control sidebar, its filters, its record listing, its participant profile, its box drawing and its Chart.js. bio.viz bundles none of it and no Chart.js of its own; it finds the kit on the page when a chart is made, and says so plainly if it is not there.

This repository keeps a copy of safety.viz's bundle, with a record of the safety.viz commit it was copied from, at `site/vendor/safety.viz/safety.viz.js`; the site and the browser tests load that copy.

## `groupComparison(element, settings)`

Makes a chart in an element and returns it. `element` is the element, or a CSS selector for it. `settings` is laid over the [defaults](#settings) and may be left out. The controls are drawn at once; nothing else is drawn until the chart is given its tables.

A setting that is not known, or a value a setting cannot take, is refused: `groupComparison` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants }`, each an array of records, one object per row. They are the tables the [core](core.md) reads, and the column settings are the core's.

| Table          | Required | One row per                   | What it adds                                                                |
| -------------- | -------- | ----------------------------- | --------------------------------------------------------------------------- |
| `results`      | yes      | participant, biomarker, visit | Everything the chart draws.                                                 |
| `participants` | no       | participant                   | Filters, and participant-level columns to group by, colour by and panel by. |

Only the results table is required. With it alone the chart has no filters, and a group comes from a column carried on the results rows: one that is not the id, the biomarker, the result, the visit, the visit order or the unit, and that holds one value for each participant. When the results rows carry no such column there is nothing to group by; the chart says so in its controls and draws everyone as one group.

With a participant table the chart shows a filter for each of its category columns, and offers those columns in the Group by, Colour by and Panel by controls. A category column is one with at most `max_levels` different values. A filter chooses participants: the ones filtered out are not drawn, and are not counted as missing a result.

## The chart's methods

The lifecycle is safety.viz's, so a page drives both libraries the same way. Each of the first three returns the chart, so calls can be chained.

| Method                        | What it does                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`            | Loads the tables and draws. The same as `setData`.                                                                                                 |
| `chart.setData(data)`         | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table. |
| `chart.setSettings(settings)` | Lays settings over the current ones and draws again. A setting that says what the chart opens on moves its control.                                |
| `chart.render()`              | Draws everything again from the tables, the settings and the controls.                                                                             |
| `chart.resize()`              | Fits the chart to its container, for a page that changes the container's size without resizing the window.                                         |
| `chart.destroy()`             | Takes the chart down and empties its element. A destroyed chart cannot be used again.                                                              |
| `chart.statistics()`          | What the chart has asked R for the panels now drawn, and what R answered: see [what R is asked](#what-r-is-asked). It draws nothing.               |

Tables the chart cannot read (not arrays of records, or a results table without one of its mapped columns) are refused: `setData` throws a `TypeError`, and the message is shown in the chart's element.

## Settings

Every setting, with its default. The column settings and the baseline settings are the [core's](core.md#default_settings), under the same names, and safety.viz's charts use the same names for the same columns.

| Setting              | Default                     | Meaning                                                                                                                                                      |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id_col`             | `'USUBJID'`                 | The participant's id, in the results table.                                                                                                                  |
| `measure_col`        | `'TEST'`                    | The biomarker's name.                                                                                                                                        |
| `value_col`          | `'STRESN'`                  | The result.                                                                                                                                                  |
| `visit_col`          | `'VISIT'`                   | The visit's name.                                                                                                                                            |
| `visit_order_col`    | `'VISITNUM'`                | A number that orders the visits. May be null.                                                                                                                |
| `unit_col`           | `'STRESU'`                  | The unit of the result, printed in the value axis title. May be null.                                                                                        |
| `participant_id_col` | `null`                      | The participant's id in the participant table, when it is not named as `id_col` is.                                                                          |
| `baseline_visits`    | `null`                      | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                            |
| `baseline_stat`      | `'mean'`                    | How several baseline visits are brought to one value: `mean`, `min`, `max` or `first`.                                                                       |
| `start_value`        | `null`                      | The biomarker the chart opens on. Null means the first by name.                                                                                              |
| `visits`             | `null`                      | The visit, or visits, the chart opens on. Null means the first visit after the baseline.                                                                     |
| `value_type`         | `'raw'`                     | The value type the chart opens on: `raw`, `baseline`, `change`, `fold_change` or `percent_change`, as the [core defines them](core.md#value_types).          |
| `group_by`           | `null`                      | The column on the axis the chart opens on. Null means the first column offered.                                                                              |
| `levels`             | `null`                      | The levels of the group the chart opens on. Null means all of them.                                                                                          |
| `color_by`           | `null`                      | The column of the second grouping, by colour. Null means none.                                                                                               |
| `panel_by`           | `null`                      | The column the panels are made by. Null means none.                                                                                                          |
| `mark`               | `'box'`                     | What a group is drawn as: `box`, `violin` or `points`.                                                                                                       |
| `y_scale`            | `'linear'`                  | The scale of the value axis: `linear` or `log`.                                                                                                              |
| `measures`           | `null`                      | The biomarkers the Biomarker control offers, in this order. Null means every biomarker in the table, by name.                                                |
| `groups`             | `null`                      | The columns offered to group, colour and panel by, as names or `{ value_col, label }`. Null means the category columns the tables have.                      |
| `max_levels`         | `12`                        | The most different values a column may hold and still be offered as a category.                                                                              |
| `filters`            | `null`                      | The filters, as names or `{ value_col, label }`, with safety.viz's `start`, `all` and `multiple`. Null means every category column of the participant table. |
| `details`            | `null`                      | The columns of the listing, as names or `{ value_col, label }`. Null means the participant, the group, the colour, the panel and the value.                  |
| `page_size`          | `10`                        | Rows on a page of the listing.                                                                                                                               |
| `connection`         | `null`                      | The connection to R the statistics line asks. Null means one with no R attached.                                                                             |
| `statistic`          | `'Analyze_GroupDifference'` | The R function the statistics line asks for: gsm.bio's, or one that takes the same arguments. Null means no statistics line and no Statistics controls.      |
| `test`               | `'t'`                       | The test the chart opens on: `t`, `wilcoxon`, `anova`, `kruskal` or `none`. See [which test](#which-test).                                                   |
| `pairwise`           | `false`                     | Whether the chart opens with pairwise comparisons switched on. They are made only among more than two groups.                                                |
| `waiting_note`       | `null`                      | A sentence added to the waiting text until R has answered once: what starting R costs on this page. Null means none.                                         |
| `profile`            | `true`                      | Whether a row of the listing opens safety.viz's participant profile.                                                                                         |
| `profile_details`    | `null`                      | The participant's columns shown at the head of the profile. Null means the category columns.                                                                 |
| `studyday_col`       | `null`                      | A column of the results table holding the study day of each result: the time axis of the profile. Without it the profile draws no lines over time.           |
| `normal_col_high`    | `null`                      | A column holding the upper limit of normal of each result, when the results have one.                                                                        |
| `normal_col_low`     | `null`                      | A column holding the lower limit of normal.                                                                                                                  |

## What is drawn

Each panel is one Chart.js chart. The levels of the group are along the axis; under each is its name and the number of participants drawn there, `n = 95`, and with a colour the number in each colour, `42 · 53`. The value axis is named for the variable, with its unit.

| Mark     | What it is                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `box`    | safety.viz's box: the box from the first to the third quartile, a line at the median, whiskers to the 5th and 95th percentiles, and a marker at the mean. It is the box safety.viz's results over time chart draws. |
| `violin` | The outline of a Gaussian kernel density of the values, from the least value to the greatest, with a line at the median. Every violin is as wide as its slot at its widest.                                         |
| `points` | One point per participant, at its value, placed across its group's slot at a position fixed by the participant's id.                                                                                                |

The quantiles are worked out by linear interpolation between the two nearest values, at position (n − 1)p: R's `quantile(type = 7)`, its default, and the rule safety.viz's boxes use. A violin's smoothing width is R's `bw.nrd0`, the default of `density()`. On a logarithmic axis a violin's outline is worked out on the logarithm of the values. Every one of these numbers is held to desktop R by the unit tests, on the synthetic study.

These numbers describe the values being drawn. None of them compares one group with another.

A second grouping by colour splits each level into cells side by side, with a legend. Panels by one further variable give one panel per level of it; more than one visit gives one panel per visit; with both, one per visit and level. All panels share one value axis.

On a logarithmic scale a value of zero or less cannot be shown. It is left out, and the note above the chart counts how many were.

The note above the chart says how many participants were drawn, of how many, and why any was left out, in the [core's words](core.md#dropped).

## The controls

In safety.viz's sidebar, in five sections.

| Section    | Control              | What it sets                                                                           |
| ---------- | -------------------- | -------------------------------------------------------------------------------------- |
| Value      | Biomarker            | The biomarker.                                                                         |
| Value      | Value                | The value type: result, baseline, change, fold change or percent change from baseline. |
| Value      | Visit                | The visit, or visits. Not shown for a baseline value, which has no visit.              |
| Groups     | Group by             | The column on the axis.                                                                |
| Groups     | Levels               | Which of its levels are drawn.                                                         |
| Groups     | Colour by            | The second grouping, or none.                                                          |
| Groups     | Panel by             | The variable the panels are made by, or none.                                          |
| Display    | Draw as              | Box, violin or points.                                                                 |
| Display    | Scale                | Linear or logarithmic.                                                                 |
| Statistics | Test                 | The test R is asked for, from the ones that fit the number of groups drawn, or none.   |
| Statistics | Pairwise comparisons | Whether every pair of groups is compared as well. Shown with more than two groups.     |
| Filters    | one per filter       | The participants drawn. Only with a participant table.                                 |
|            | Reset chart          | Returns every control to what the chart opened on.                                     |

The Statistics section is there when the setting `statistic` names a function. There is no control that chooses an adjustment, a confidence level, a minimum group size or a cut: those are R's.

## Listing and participant profile

Clicking a box or a violin lists its participants under the chart, in safety.viz's record listing, with its search, its sorting, its paging and a CSV export. Clicking a point lists that participant and opens their profile. A change to a control or a filter empties the list, so it never lists a box that is no longer drawn.

Clicking a row selects that participant. The chart then raises the event safety.viz's charts raise, `participantsSelected`, on its own root element, and the event bubbles: `event.detail.data` is a list holding the participant's id, or an empty list when the selection is cleared. safety.viz's participant profile opens on that event, in a rail beside the chart, and any other chart on the page can listen for it.

The profile was made for laboratory results that carry a reference range. For results that have one, name its columns in `normal_col_high` and `normal_col_low`. For results that have none, as biomarker results often do, the profile shows each biomarker as a multiple of the participant's first result, and no reference range is drawn or implied. Its time axis is a study day: name the column that holds it in `studyday_col`.

## The statistics line

Under each panel. The chart computes no test, no estimate, no interval, no p-value and no adjustment. It chooses which test to ask R for, hands R the rows of the panel through the connection in the setting `connection`, and prints what R returns through the formatters every chart shares: [`formatStatistic`, `formatEstimate` and `formatComparison`](r-connection.md#formatstatisticstatistic). With no connection given the chart makes one with no R attached, and the line reads `Statistics are unavailable: no R is attached to this chart.`

### Which test

The function is gsm.bio's `Analyze_GroupDifference`, which runs R's own `t.test`, `wilcox.test`, `aov` and `kruskal.test`. The Test control offers the tests that fit the number of groups drawn, which is the number of levels on the axis, and no others:

| Groups drawn   | Test control offers                        | `strMethod`        |
| -------------- | ------------------------------------------ | ------------------ |
| two            | Welch t-test, Wilcoxon rank-sum test, None | `t`, `wilcoxon`    |
| three or more  | One-way ANOVA, Kruskal-Wallis test, None   | `anova`, `kruskal` |
| fewer than two | nothing: the control is switched off       | R is not asked     |

The setting `test` says which the chart opens on, and its default is `t`. A test that does not fit the number of groups drawn gives way to the one of its kind that does: `t` and `anova` to each other, the two that compare means, and `wilcoxon` and `kruskal` to each other, the two that compare ranks. So the default is a Welch t-test for two groups and a one-way ANOVA for more, and a chart that goes from two groups to four keeps the kind of test the reader chose. The control always shows the test that is asked for, and R is never sent a test it would refuse for the number of groups. `none` asks R for nothing: the line reads `Statistics: no test chosen.`, and a page that sets it starts no R until the reader chooses a test.

The Pairwise comparisons switch, the setting `pairwise`, is off by default. Switched on with more than two groups, R also compares every pair of groups, by Welch t-test under a one-way ANOVA and by Wilcoxon rank-sum test under a Kruskal-Wallis test, and adjusts the p-values across the pairs by Holm's method, which is gsm.bio's default. With two groups there is one pair, which is the test itself, and the switch is not shown.

### What one test covers

One test per panel, on that panel's rows: the participants drawn in it, one row each. With several panels, by visit or by a panel variable, each panel asks for itself and is answered for itself, and the tests are not adjusted for one another. A second grouping by colour is not part of the test: each level of the group on the axis is tested whole, across its colours. A filter narrows the rows, and so the test. A level of the group that is drawn elsewhere and has no participant in a panel is not one of that panel's groups; a panel left with fewer than two groups is not sent to R, and its line says that a test compares two or more groups.

The line says all of this under each result: `This test compares the levels of Arm on the 84 participants drawn in this panel (F). Each panel has a test of its own, and they are not adjusted for one another. Filters: Response is Responder.`

### What is printed

| Part                 | Where it comes from                         | Example                                                                                                                    |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The result           | `method`, `p_value`, `counts`, `adjustment` | `Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.`                          |
| The difference       | the row of `estimates` with an interval     | `Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.`                                |
| Pairwise comparisons | `rows`                                      | A table: each pair, its two counts and its adjusted p-value, captioned with the method and `Exploratory, adjusted (Holm).` |
| What R said          | `warnings`, `notes`                         | `R warned: cannot compute exact p-value with ties`                                                                         |
| What the test covers | the chart                                   | `This test compares the levels of Arm on the 186 participants drawn.`                                                      |

The difference in means is printed for two groups, where R returns it: the first group's mean minus the second's, in the order R names them, with the interval R's `t.test` gives, whichever test was asked for. Numbers other than a p-value are printed to four significant figures, the precision of the chart's tooltips; a p-value is printed by the [shared rule](r-connection.md#formatstatisticstatistic). Nothing is rounded before it is printed, and no printed number is worked out here.

R's warnings and notes are printed with the result, as R worded them. A group below the minimum size, which is R's to set, prints R's reason and no number: `Not computed: Treatment has 1. The minimum group size is 5. Counts: Placebo n = 7, Treatment n = 1.` A result R marks as an error prints R's message after `R reported an error:`. There are no stars, and the word significant is never printed.

### Waiting, and never a stale answer

Two rules keep a wrong number from standing under a chart:

- From the moment a result is asked for until it arrives, the line reads `Statistics: waiting for R…`. Until R has answered once, the setting `waiting_note` is added to it: a page says there what starting R costs.
- Every time the chart is drawn the line is cleared and asked for again, and an answer that was asked for before the chart was last drawn is dropped when it arrives. A change to the test, the pairwise switch, a filter or any variable draws the chart again. The line never shows an answer for rows other than the ones on screen.

### What R is asked

For each panel that has a test, one call:

```js
connection.run('Analyze_GroupDifference', {
  data, // the panel's rows: the participant's id, `y`, `x`, and `color` and `panel` when set
  args: { strValueCol: 'y', strGroupCol: 'x', strMethod: 't', bPairwise: false },
  dataId // what the rows are: see below
});
```

| Argument      | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `strValueCol` | Always `'y'`.                                                                                            |
| `strGroupCol` | Always `'x'`.                                                                                            |
| `strMethod`   | The test asked for: `'t'`, `'wilcoxon'`, `'anova'` or `'kruskal'`.                                       |
| `bPairwise`   | `true` when the pairwise switch is on and the panel's rows hold more than two groups; otherwise `false`. |

Nothing else is sent. The groups are the ones in the rows, in the order R sorts them; the adjustment, the confidence level and the minimum group size are gsm.bio's defaults, and each is printed from what R returns.

`dataId` states what the rows are. A [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together, so the identity is built only from what the settings and the controls say, by the settings' own names, and from the group names in the rows:

| Member            | Value                                                                                                                 | Left out when                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `chart`           | `'group-comparison'`.                                                                                                 | never                              |
| `measure`         | The biomarker.                                                                                                        | never                              |
| `value_type`      | `raw`, `baseline`, `change`, `fold_change` or `percent_change`.                                                       | never                              |
| `visit`           | The panel's visit.                                                                                                    | the value type is `baseline`       |
| `baseline_visits` | The setting, as a list.                                                                                               | the setting is null                |
| `baseline_stat`   | The setting.                                                                                                          | never                              |
| `group_by`        | The column on the axis.                                                                                               | never, for a panel that has a test |
| `groups`          | The distinct values of `x` in the rows, as text, sorted by code point.                                                | never                              |
| `color_by`        | The colour column.                                                                                                    | there is no colour                 |
| `panel_by`        | The panel column.                                                                                                     | there are no panels by a variable  |
| `panel`           | The panel's level of that column.                                                                                     | there are no panels by a variable  |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point. | no filter is in force              |
| `positive_only`   | `true` on a logarithmic scale, where a value of zero or less is left out.                                             | the scale is linear                |

A member that is not set is left out, never written as null. A list is a list whatever its length. Sorting by code point is what R's `sort(x, method = "radix")` does, so both sides write the same list without a locale.

`chart.statistics()` returns what the chart has asked for the panels now drawn, one entry per panel that asked: `{ panel, name, args, dataId, rows, answer }`, where `rows` is the number of rows handed over and `answer` is what the connection resolved to, or null while R has not answered. It is the key a stored result must carry, read from the chart itself.

### Stored results, from R

A page that ships R's answers gives the chart a connection with `results`: one stored result per panel of the views it computed. One biomarker at several visits is several panels, and so several stored results, each with its own `visit`. A view with no stored result reads `Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.` It is never answered with another view's numbers: a different test, pairwise switch, biomarker, visit, value type, group, colour, panel or filter is a different key.

In R, the key of one panel's stored result, from the panel's rows and what the view is set to:

```r
# dfRows: the panel's rows, one per participant: the id, y, x (and color, panel when set).
# lView:  the view, by the chart's names; a member that is not set is NULL.
group_comparison_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(as.character(dfRows$x)), method = "radix")
  lDataId <- list(chart = "group-comparison", measure = lView$measure, value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- lView$visit
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(lView$baseline_visits)
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (!is.null(lView$color_by)) lDataId$color_by <- lView$color_by
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- lView$panel
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(as.character(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  list(
    name = lView$statistic,
    args = list(
      strValueCol = "y", strGroupCol = "x", strMethod = lView$test,
      bPairwise = isTRUE(lView$pairwise) && length(chrGroups) > 2
    ),
    dataId = lDataId,
    rows = nrow(dfRows)
  )
}

lKey <- group_comparison_key(dfRows, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfRows), lKey$args))))
```

`lView$test` is the test asked for, which is the setting `test` where it fits the number of groups on the axis and its counterpart where it does not. `lView$filters` is a named list of column to the values the filter lets through. Written to JSON, a single value is a single value and an unnamed list is an array (`jsonlite::toJSON(auto_unbox = TRUE)`), and the value is in [the shape the browser form gives](r-connection.md#stored-results).

This is the function `tools/r-group-statistics.R` writes the chart's expected results with. The unit tests named `GC-STAT-023` hold the key it writes, for thirteen panels of the gallery's demo, to the key the chart asks with, and hand its results to a connection as stored results to see each one found.

### In the browser

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, as the connection's `browser.sourceUrl`. This repository keeps a copy at `site/vendor/gsm.bio/statistics.R`, with a record of the gsm.bio commit it was copied from, and the site publishes it at `vendor/gsm.bio/statistics.R`. The file is sourced with base R alone. It names the survival package only inside its survival functions, which this chart never calls, so a page that draws only this chart installs no package: `browser: { sourceUrl, packages: [] }`.

Nothing is fetched until the chart first asks for a test, which is the first time it draws a panel that prints one. A chart that opens with `test: 'none'`, or on a view with no test to print, asks for nothing until the reader chooses.

The answers are checked against desktop R. `tools/r-group-statistics.R` sources the same vendored file in desktop R, runs it on rows the chart's own code wrote, and writes `tests/fixtures/group-statistics-r.json` with the R version that made it. The browser tests named `GC-STAT-034` to `GC-STAT-042` run the gallery's chart against real R in the browser and hold every number to that file within 1 part in 10^8. R in the browser is a newer R than the desktop one that wrote the file, and R's own answer differs between them in one known case: with tied values and fewer than 50 in each group, `wilcox.test` in R 4.3 warns and approximates where R 4.6 computes the exact p-value. Where that happens the tests compare every other number and print both versions' numbers side by side; the tolerance is not widened.

## On a phone

Below 900 pixels of width safety.viz's shell stacks: the controls above the chart, the participant profile below it. Below 600 pixels the controls start folded away, so the chart is on the first screen, and one tap on Controls opens them. Panels drop to one column. The listing wraps its cells instead of running off the page.

## What is not here

No statistical test, estimate, interval, p-value or adjustment is computed here: the chart chooses which of R's to ask for and prints R's answer. And no rule that cuts a continuous variable into groups: a group comes from a column.
