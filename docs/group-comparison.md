# The group comparison chart

Does this biomarker differ between these groups? The chart draws one value across the levels of a category at chosen visits, as boxes, violins or points, with the number in each group beneath. It takes a second grouping by colour, panels by one further variable and a logarithmic scale. Clicking a box or a point lists its participants, and a row of the list opens the participant's profile.

It draws; it does not test. The line under the chart is where a test of the groups is printed, and that test is computed by R and asked for through the [connection to R](r-connection.md). With no R attached the line says that statistics are unavailable.

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
    group_by: 'ARM'
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
| `statistic`          | `'Analyze_GroupDifference'` | The R function the statistics line asks for. Null means no statistics line.                                                                                  |
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

In safety.viz's sidebar, in four sections.

| Section | Control        | What it sets                                                                           |
| ------- | -------------- | -------------------------------------------------------------------------------------- |
| Value   | Biomarker      | The biomarker.                                                                         |
| Value   | Value          | The value type: result, baseline, change, fold change or percent change from baseline. |
| Value   | Visit          | The visit, or visits. Not shown for a baseline value, which has no visit.              |
| Groups  | Group by       | The column on the axis.                                                                |
| Groups  | Levels         | Which of its levels are drawn.                                                         |
| Groups  | Colour by      | The second grouping, or none.                                                          |
| Groups  | Panel by       | The variable the panels are made by, or none.                                          |
| Display | Draw as        | Box, violin or points.                                                                 |
| Display | Scale          | Linear or logarithmic.                                                                 |
| Filters | one per filter | The participants drawn. Only with a participant table.                                 |
|         | Reset chart    | Returns every control to what the chart opened on.                                     |

There is no control that chooses a test, an adjustment or a cut. Those belong to R, and arrive with the statistics.

## Listing and participant profile

Clicking a box or a violin lists its participants under the chart, in safety.viz's record listing, with its search, its sorting, its paging and a CSV export. Clicking a point lists that participant and opens their profile. A change to a control or a filter empties the list, so it never lists a box that is no longer drawn.

Clicking a row selects that participant. The chart then raises the event safety.viz's charts raise, `participantsSelected`, on its own root element, and the event bubbles: `event.detail.data` is a list holding the participant's id, or an empty list when the selection is cleared. safety.viz's participant profile opens on that event, in a rail beside the chart, and any other chart on the page can listen for it.

The profile was made for laboratory results that carry a reference range. For results that have one, name its columns in `normal_col_high` and `normal_col_low`. For results that have none, as biomarker results often do, the profile shows each biomarker as a multiple of the participant's first result, and no reference range is drawn or implied. Its time axis is a study day: name the column that holds it in `studyday_col`.

## The statistics line

Under each panel. The chart hands the rows it drew to R through the connection in the setting `connection`:

```js
connection.run('Analyze_GroupDifference', {
  data, // the panel's rows: the participant's id, `y` and `x`
  args: { strValueCol: 'y', strGroupCol: 'x' },
  dataId // what the rows are: the variable, the group, the levels, the panel, the filters
});
```

and prints the answer through `BioViz.r.formatStatistic`, the one place a p-value is formatted. With no connection given the chart makes one with no R attached, and the line reads `Statistics are unavailable: no R is attached to this chart.`

Two rules keep a wrong number from standing under a chart:

- From the moment a result is asked for until it arrives, the line reads `Statistics: waiting for R…`.
- Every time the chart is drawn the line is cleared and asked for again, and an answer that was asked for before the chart was last drawn is dropped when it arrives. The line never shows an answer for rows other than the ones on screen.

The chart computes no test, no estimate, no interval and no p-value, and has no setting that chooses one.

## On a phone

Below 900 pixels of width safety.viz's shell stacks: the controls above the chart, the participant profile below it. Below 600 pixels the controls start folded away, so the chart is on the first screen, and one tap on Controls opens them. Panels drop to one column. The listing wraps its cells instead of running off the page.

## What is not here

No statistical test, estimate, interval, p-value or adjustment, and no rule that cuts a continuous variable into groups: a group comes from a column. Those arrive with the statistics, computed by R.
