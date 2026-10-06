# The group comparison chart

Does this biomarker differ between these groups? The chart draws one value across the levels of a category at chosen visits, as boxes, violins or points, with the number in each group beneath. It takes a second grouping by colour, panels by one further variable and a logarithmic scale. Clicking a box or a point lists its participants, and a row of the list opens the participant's profile.

It has three levels. It opens on [a tile for every biomarker](#the-trend-tiles), each a line per group through the group's median at every scheduled visit. A tile opens [that biomarker over time](#one-biomarker-over-time): one picture, visit along the bottom and the groups side by side at each, with the number in each group and R's test of the groups under each visit. A visit there opens that visit alone, which is the comparison described first. [Unscheduled visits](#unscheduled-visits) are left out of the chart until they are switched on.

It draws; it does not test. The line under the chart is where a test of the groups is printed, and that test is computed by R: the chart chooses which test to ask for, hands R the rows it drew through the [connection to R](r-connection.md), and prints what R returns. With no R attached the line says that statistics are unavailable.

## At a glance

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.2.0/bio.viz.js"></script>
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

That names a biomarker and a visit, so the chart opens on that biomarker at that visit. Leave `visits` out and it opens on that biomarker over time, across every visit it has. Leave `start_value` out too and it opens on the trend tiles: every biomarker, across every scheduled visit.

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

With a participant table the chart shows a filter for each of its category columns, and offers those columns in the Group by, Colour by and Panel by controls. A category column is one with at most `max_levels` different values. A filter chooses participants: the ones filtered out are not drawn, and are not counted as missing a result. When the filters together let nobody through, the chart draws nothing, asks R for nothing and reads `No participant passes the filters.`, the words every chart uses; loosen a filter and it draws again.

A participant table is matched to the results by the participant's id, in the column `participant_id_col` names, or `id_col`'s when that is not set. A participant table without that column is refused, with a message that names the column. A participant the results have and the participant table does not is left out and counted (`Not in the participant table`), and so is a row of results with no participant id (`Row has no participant id`). If drawing fails for any other reason, the footnote says `This chart could not be drawn:` and why, nothing half drawn is left, and the controls stay.

## The chart's methods

The lifecycle is safety.viz's, so a page drives both libraries the same way. Each of the first three returns the chart, so calls can be chained.

| Method                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`              | Loads the tables and draws. The same as `setData`.                                                                                                                                                                                                                                                                                                                                                                    |
| `chart.setData(data, settings)` | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table. `settings`, when given, are laid over the chart's with the tables, for tables that need them: a participant table whose id column has another name comes with `{ participant_id_col }`. The tables are checked against those settings, so the two change together. |
| `chart.setSettings(settings)`   | Lays settings over the current ones and draws again. A setting that says what the chart opens on moves its control.                                                                                                                                                                                                                                                                                                   |
| `chart.render()`                | Draws everything again from the tables, the settings and the controls.                                                                                                                                                                                                                                                                                                                                                |
| `chart.resize()`                | Fits the chart to its container, for a page that changes the container's size without resizing the window.                                                                                                                                                                                                                                                                                                            |
| `chart.specification()`         | The chart as JSON data: every setting as its controls now read, and every filter in force. `BioViz.fromSpecification` makes the same chart from it ([specifications](output.md#specifications)).                                                                                                                                                                                                                      |
| `chart.fileOf(kind)`            | One of the [downloads](#downloads) as a file, without saving it: a promise of `{ name, blob }`, for `kind` `'png'`, `'statistics'` or `'table'`.                                                                                                                                                                                                                                                                      |
| `chart.destroy()`               | Takes the chart down and empties its element. A destroyed chart cannot be used again.                                                                                                                                                                                                                                                                                                                                 |
| `chart.statistics()`            | What the chart has asked R for the panels now drawn, and what R answered: see [what R is asked](#what-r-is-asked). It draws nothing.                                                                                                                                                                                                                                                                                  |

Tables the chart cannot read (not arrays of records, or a results table without one of its mapped columns) are refused: `setData` throws a `TypeError`, and the message is shown in the chart's element.

## Settings

Every setting, with its default. The column settings and the baseline settings are the [core's](core.md#default_settings), under the same names, and safety.viz's charts use the same names for the same columns.

| Setting                     | Default                               | Meaning                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`                    | `'USUBJID'`                           | The participant's id, in the results table.                                                                                                                                                                                                                                                  |
| `measure_col`               | `'TEST'`                              | The biomarker's name.                                                                                                                                                                                                                                                                        |
| `value_col`                 | `'STRESN'`                            | The result.                                                                                                                                                                                                                                                                                  |
| `visit_col`                 | `'VISIT'`                             | The visit's name.                                                                                                                                                                                                                                                                            |
| `visit_order_col`           | `'VISITNUM'`                          | A number that orders the visits. May be null.                                                                                                                                                                                                                                                |
| `unit_col`                  | `'STRESU'`                            | The unit of the result, printed in the value axis title. May be null.                                                                                                                                                                                                                        |
| `participant_id_col`        | `null`                                | The participant's id in the participant table, when it is not named as `id_col` is.                                                                                                                                                                                                          |
| `baseline_visits`           | `null`                                | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                                                                                                                                                            |
| `baseline_stat`             | `'mean'`                              | How several baseline visits are brought to one value: `mean`, `min`, `max` or `first`.                                                                                                                                                                                                       |
| `start_value`               | `null`                                | The biomarker the chart opens on. Null means none: the chart opens on [the trend tiles](#the-trend-tiles) of every biomarker, as it does for a name the table lacks.                                                                                                                         |
| `visits`                    | `null`                                | The visit, or visits, the chart opens on. Null means every visit the chart draws: every scheduled visit, and the unscheduled ones when they are switched on. With a biomarker named, every visit it has is [that biomarker over time](#one-biomarker-over-time), and fewer are a panel each. |
| `value_type`                | `'raw'`                               | The value type the chart opens on: `raw`, `baseline`, `change`, `fold_change` or `percent_change`, as the [core defines them](core.md#value_types).                                                                                                                                          |
| `group_by`                  | `null`                                | The column on the axis the chart opens on, or a biomarker or number [cut into groups](#a-cut-biomarker-as-the-groups): `{ measure: 'CRP', visit: 'Baseline', cut: 'median' }`. Null means the first column offered.                                                                          |
| `levels`                    | `null`                                | The levels of the group the chart opens on. Null means all of them.                                                                                                                                                                                                                          |
| `color_by`                  | `null`                                | The column of the second grouping, by colour. Null means none.                                                                                                                                                                                                                               |
| `panel_by`                  | `null`                                | The column the panels are made by, or a cut variable, as `group_by` takes one. Null means none.                                                                                                                                                                                              |
| `mark`                      | `'box'`                               | What a group is drawn as with a visit open: `box`, `violin` or `points`.                                                                                                                                                                                                                     |
| `time_mark`                 | `'box'`                               | What [one biomarker over time](#one-biomarker-over-time) is drawn as: `box`, a box per group at each visit; `mean_se`, each group's mean with one standard error either side; or `median_iqr`, its median with the quartiles either side. The Draw as control switches it there.             |
| `y_scale`                   | `'linear'`                            | The scale of the value axis: `linear` or `log`.                                                                                                                                                                                                                                              |
| `measures`                  | `null`                                | The biomarkers the Biomarker control offers, in this order. Null means every biomarker in the table, by name.                                                                                                                                                                                |
| `groups`                    | `null`                                | The columns offered to group, colour and panel by, as names or `{ value_col, label }`. Null means the category columns the tables have.                                                                                                                                                      |
| `max_levels`                | `12`                                  | The most different values a column may hold and still be offered as a category.                                                                                                                                                                                                              |
| `filters`                   | `null`                                | The filters, as names or `{ value_col, label }`, with safety.viz's `start`, `all` and `multiple`. Null means every category column of the participant table.                                                                                                                                 |
| `unscheduled_visits`        | `false`                               | Whether [unscheduled visits](#unscheduled-visits) are drawn. Off, they are in no tile, not in the Visit control and not a panel. The Unscheduled visits control switches it.                                                                                                                 |
| `unscheduled_visit_pattern` | `'/unscheduled\|early termination/i'` | The regular expression an unscheduled visit's name matches, written as text: `/source/flags`, or a plain source. safety.viz's default. Null means none.                                                                                                                                      |
| `unscheduled_visit_values`  | `null`                                | The unscheduled visits, by name, or a list of them. When given, the list decides alone and the pattern is not read; an empty list means no visit is unscheduled.                                                                                                                             |
| `tile_summary`              | `'median'`                            | What a line of a [trend tile](#the-trend-tiles) goes through: each group's `median` at each visit, or its `mean`. The Tiles draw control switches it.                                                                                                                                        |
| `tile_min_spread`           | `1.25`                                | The least a tile's value axis spans, in standard deviations of the results at the baseline visit: a number, zero or more. Zero means no least. See [a tile's value axis](#a-tiles-value-axis).                                                                                               |
| `overview_limit`            | `12`                                  | Not applied since v0.3.0. It was the most biomarkers v0.2.0's overview drew at a time; the tiles draw every biomarker. Still read and checked, a whole number of one or more, so settings and a specification written for v0.2.0 are not refused.                                            |
| `details`                   | `null`                                | The columns of the listing, as names or `{ value_col, label }`. Null means the participant, the group, the colour, the panel and the value.                                                                                                                                                  |
| `page_size`                 | `10`                                  | Rows on a page of the listing.                                                                                                                                                                                                                                                               |
| `connection`                | `null`                                | The connection to R the statistics line asks. Null means one with no R attached.                                                                                                                                                                                                             |
| `statistic`                 | `'Analyze_GroupDifference'`           | The R function the statistics line asks for: gsm.bio's, or one that takes the same arguments. Null means no statistics line and no Statistics controls.                                                                                                                                      |
| `test`                      | `'t'`                                 | The test the chart opens on: `t`, `wilcoxon`, `anova`, `kruskal` or `none`. See [which test](#which-test).                                                                                                                                                                                   |
| `pairwise`                  | `false`                               | Whether the chart opens with pairwise comparisons switched on. They are made only among more than two groups.                                                                                                                                                                                |
| `statistic_by_visit`        | `'Analyze_GroupDifferenceBy'`         | The R function asked for the test at every visit of [one biomarker over time](#one-biomarker-over-time), in one request: gsm.bio's, or one that takes the same arguments and returns a row per visit. Null means no row of tests there.                                                      |
| `visit_adjustment`          | `'none'`                              | How R adjusts the p-values across the visits of one biomarker over time, by the name R's `p.adjust()` gives it: `none`, `holm` or `BH`. The Adjust across visits control switches it. R makes the adjustment; the chart names it.                                                            |
| `waiting_note`              | `null`                                | A sentence added to the waiting text until R has answered once: what starting R costs on this page. Null means none.                                                                                                                                                                         |
| `back`                      | `null`                                | A way back, for a chart that opened this one in its place: `{ label, action }`. A button above the chart calls `action` with the chart. Null means none.                                                                                                                                     |
| `profile`                   | `true`                                | Whether a row of the listing opens safety.viz's participant profile.                                                                                                                                                                                                                         |
| `profile_details`           | `null`                                | The participant's columns shown at the head of the profile. Null means the category columns.                                                                                                                                                                                                 |
| `studyday_col`              | `null`                                | A column of the results table holding the study day of each result: the time axis of the profile. Without it the profile draws no lines over time.                                                                                                                                           |
| `normal_col_high`           | `null`                                | A column holding the upper limit of normal of each result, when the results have one.                                                                                                                                                                                                        |
| `normal_col_low`            | `null`                                | A column holding the lower limit of normal.                                                                                                                                                                                                                                                  |
| `title`                     | `null`                                | The title above the chart: text with placeholders such as `{n}`, filled from the view drawn ([titles and footnotes](#titles-and-footnotes)). Null means none.                                                                                                                                |
| `subtitle`                  | `null`                                | The line under the title, written the same way. Null means none.                                                                                                                                                                                                                             |
| `page`                      | `0`                                   | Not applied since v0.3.0. It was the page of v0.2.0's overview; the tiles have no pages. Still read and checked, a whole number from 0, and kept by a specification.                                                                                                                         |
| `footnotes`                 | `null`                                | Footnotes under the chart: text, or a list of texts, with placeholders. The chart's own footnote is always last. Null means none but that one.                                                                                                                                               |
| `downloads`                 | `true`                                | Whether the downloads are offered under the chart: the PNG, the statistics and the table ([downloads](#downloads)).                                                                                                                                                                          |
| `png_scale`                 | `2`                                   | The PNG's resolution: image pixels per CSS pixel, from 1 to 4. At 2 the picture is twice the size it is drawn on the page, 192 pixels to the inch.                                                                                                                                           |

## Titles and footnotes

The settings `title`, `subtitle` and `footnotes` are text with named placeholders, filled from the view drawn each time the chart draws. A placeholder is a name in braces, and it is replaced by text: nothing in a setting or a value is evaluated, and a name the chart does not have is left as written. The title and the subtitle are drawn above the chart, and the footnotes under it; the chart's own footnote, always last, says when and by what it was drawn and what stands behind each statistic printed. The rules are in [Getting results out](output.md).

| Placeholder | What it holds                                                                    |
| ----------- | -------------------------------------------------------------------------------- |
| `{measure}` | The biomarker drawn, or `every biomarker` on the trend tiles.                    |
| `{visits}`  | The visits chosen, separated by commas.                                          |
| `{value}`   | What is drawn of the value: `Result`, `Change from baseline` and so on.          |
| `{group}`   | What the groups are, as the Group control names it; empty for none.              |
| `{n}`       | How many participants are drawn: on the trend tiles, behind a point of any tile. |
| `{filters}` | The filters in force, in words, or `none`.                                       |
| `{date}`    | The date drawn, in UTC: `2026-10-04`.                                            |
| `{version}` | The bio.viz version.                                                             |

## Downloads

Under the footnotes a bar offers three downloads, each saved as a file named for the chart and the view, such as `bio.viz-group-comparison-….png`, at every level. The trend tiles ask R nothing, so they offer the PNG and the table:

| Download         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PNG              | The chart's frame as a picture: the title and subtitle, the notes, what the chart draws (for one biomarker over time, the picture and the table under it), the statistics line and the footnotes, the chart's own last, at `png_scale` image pixels per CSS pixel. The file carries its resolution, and as text its title, its footnotes and the bio.viz version that made it, and nothing else ([the PNG](output.md#the-png)). What a reader works the chart with (the controls, the hint, the listing, the bar) is left out, and what scrolls sideways is drawn whole. |
| Statistics (CSV) | The statistics R returned for the view, as shown: a row for each answer's result and one for each of its parts, every member R returned a column and every number as R returned it. Offered once R has answered. For one biomarker over time that is one answer, with a row for each visit holding its counts, its p-value as R computed it (`p_unadjusted`) and as R adjusted it (`p_value`), and the adjustment.                                                                                                                                                       |
| Table (CSV)      | The table the chart drew from: one row per participant per visit drawn: the participant, the visit, the group, the colour and the panel where there are any, and the value drawn. On the trend tiles, one row per participant, biomarker and visit, with the biomarker named: the values each point is the median or the mean of. For one biomarker over time, one row per participant and visit: the values each box, mean or median is drawn from.                                                                                                                     |

A CSV file is written by RFC 4180: a field, or a heading, that holds a comma, a double quote or a line break is quoted. `chart.fileOf(kind)` gives the same file without saving it: a promise of `{ name, blob }`, for `kind` `'png'`, `'statistics'` or `'table'`. The format of each file is in [Getting results out](output.md#downloads).

## What is drawn

This section is the view with a visit open: one biomarker at one visit, or at a few. Each panel is one Chart.js chart. The levels of the group are along the axis; under each is its name and the number of participants drawn there, `n = 95`, and with a colour the number in each colour, `42 · 53`. The value axis is named for the variable, with its unit.

| Mark     | What it is                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `box`    | safety.viz's box: the box from the first to the third quartile, a line at the median, whiskers to the 5th and 95th percentiles, and a marker at the mean. It is the box safety.viz's results over time chart draws. |
| `violin` | The outline of a Gaussian kernel density of the values, from the least value to the greatest, with a line at the median. Every violin is as wide as its slot at its widest.                                         |
| `points` | One point per participant, at its value, placed across its group's slot at a position fixed by the participant's id.                                                                                                |

The quantiles are worked out by linear interpolation between the two nearest values, at position (n − 1)p: R's `quantile(type = 7)`, its default, and the rule safety.viz's boxes use. A violin's smoothing width is R's `bw.nrd0`, the default of `density()`. On a logarithmic axis a violin's outline is worked out on the logarithm of the values. Every one of these numbers is held to desktop R by the unit tests, on the synthetic study.

These numbers describe the values being drawn. None of them compares one group with another.

A second grouping by colour splits each level into cells side by side, with a legend. Panels by one further variable give one panel per level of it; more than one visit gives one panel per visit; with both, one per visit and level. All panels share one value axis.

For a change, a fold change or a percent change from baseline, the baseline visit itself is not drawn when it is the only baseline visit: there the value is the same for every participant by definition, no change or a fold of one, and there is nothing to draw or to compare. The note above the chart says so. With several baseline visits a value at one of them is measured against the baseline over all of them, and every visit is drawn.

On a logarithmic scale a value of zero or less cannot be shown. It is left out, and the note above the chart counts how many were.

The note above the chart says how many participants were drawn, of how many, and why any was left out, in the [core's words](core.md#dropped).

The groups' labels under a panel stay level when they fit, and turn when they would run into one another, as narrow visit panels' long group names would.

## The trend tiles

With no biomarker chosen the chart draws every biomarker: the view it opens on when `start_value` is null, and the entry All Biomarkers at the head of the Biomarker control. It is the way in, as the all-measures view of safety.viz's histogram is, and it shows what a reader comes for first: which biomarkers move, in which group, and when.

- One tile per biomarker, in the Biomarker control's order: the setting `measures`, or by name. A tile is headed by the biomarker's name.
- In a tile, one line per group, in the group's colour, through the group's median at each visit chosen, in visit order along the tile. The Tiles draw control, the setting `tile_summary`, switches every line to the group's mean. The first and the last visit are named under the lines.
- One key above all the tiles says what a line goes through and names the groups in their colours: `Median result by Arm:`, `Placebo`, `Treatment`. A group keeps its colour when another is left out by the Levels control.
- Each biomarker has [its own value axis](#a-tiles-value-axis), and the axis's range and unit are printed under the tile: `6.1 to 8.3 pg/mL`.
- A tile is a button named `View IL-6`, with its range read out with it: a click on it, or Enter or Space when the keyboard is on it, opens [that biomarker over time](#one-biomarker-over-time), across every visit chosen. All Biomarkers in the Biomarker control leads back, and Reset chart returns to whichever the settings open on.
- Every biomarker is drawn. There are no pages: a study of thirty-six biomarkers is thirty-six tiles.

Every visit chosen keeps its place along every tile, so the tiles line up. Where a group has no value at a visit it has no point there, and its line runs on to its next value; a biomarker with no value to draw says so in its tile.

Which of the chart's levels is drawn is decided by what the controls are set to, in one place (`src/group-comparison/level.js`), and the chart's root element carries it as `data-level`:

| Level        | When                                                                                           | What is drawn                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `biomarkers` | No biomarker chosen: `start_value` null, or All Biomarkers in the control.                     | The trend tiles.                                                                      |
| `over-time`  | A biomarker chosen, and every visit it has values at: the Visit control on all visits.         | [That biomarker over time](#one-biomarker-over-time), with R's test under each visit. |
| `visits`     | A biomarker chosen and some of its visits; or a biomarker with one visit; or a baseline value. | That biomarker, a panel per visit chosen, each with R's test.                         |

Once a biomarker is open the level is named above the chart, as a trail that leads back: `All biomarkers › IL-6 over time › Week 4`. Each part before the last is a button.

Group by, Levels, Value, Scale, Visit and the filters apply to every tile, as they do to one biomarker. Three controls are not read by the tiles; each is switched off there, keeps what it is set to, and says where it applies:

| Control    | On the tiles                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Colour by  | Switched off, with the words `Applies once a biomarker and a visit are open.` A tile's lines are the groups. |
| Panel by   | Switched off, with the same words.                                                                           |
| Draw as    | Switched off, with the words `Applies when one biomarker is open.` A tile draws lines.                       |
| Tiles draw | There only on the tiles: Medians or Means.                                                                   |
| Statistics | Not there. The tiles print no test, so they offer none.                                                      |

For a change, a fold change or a percent change from baseline a tile keeps the baseline visit, where every line starts at no change, and draws a dashed line across the tile there. A baseline value has no visit, so each group is one point, the tile says `Baseline value` under it, and the note above says so.

Nothing is pooled, and nothing is compared. Every point is a description of the records that biomarker's own view draws for that group at that visit, one per participant from the [core's frame](core.md): how many there are, their median and their mean. The quantile rule and the mean are the ones a box is drawn from, and on the synthetic study every tile's medians, means and counts are held to desktop R's `median()`, `mean()` and `length()`. The counts of who was left out, and why, are a biomarker's own and are given when it is opened.

The tiles print no statistics line and ask R for nothing: no request, no start of R, no waiting text, and `chart.statistics()` is an empty list. A page never shows dozens of unadjusted p-values at once. A test is asked for and printed only with one biomarker open: one request for the row of visits over time, and one per panel with a visit open.

### A tile's value axis

Each biomarker has its own value axis, so biomarkers on different scales do not flatten one another. Left at that, every tile would stretch its own lines to fill it, and two groups a hair apart would look as far apart as two groups that truly differ. So an axis is never narrower than a set multiple of the standard deviation of the results at the baseline visit:

1. The axis runs from the least point drawn in the tile to the greatest.
2. If that is less than `tile_min_spread` standard deviations, 1.25 by default, it is widened about its middle until it spans that much. Lines that differ by less stay close to flat; a gap opens up only where the groups differ by something like the spread of the biomarker itself.
3. A tenth of what it spans is added as room at each end, and the two ends are what is printed under the tile.

The standard deviation is R's `sd()`, the square root of the sum of squares about the mean over n − 1, of each participant's baseline value as the [core](core.md) works it out, among the participants the filters and the Levels control leave. It describes the values; it compares no group with another. On the synthetic study it is held to desktop R's. It is in the units of what the tile draws:

| The tile draws                                                      | The least the axis spans, for a multiple of 1                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A result, a baseline value, a change                                | The standard deviation.                                                                                          |
| A fold change                                                       | The standard deviation over the mean of the baseline values.                                                     |
| A percent change                                                    | A hundred times that.                                                                                            |
| On a logarithmic scale, a result, a baseline value or a fold change | A ratio: ten to the power of the standard deviation of the base-10 logarithms of the baseline values above zero. |
| On a logarithmic scale, a change or a percent change                | None: a difference is not a ratio, and the axis is left at its points.                                           |

Where there is no such number (fewer than two baseline values, or a mean of zero under a fold change) the axis is left at its points and their room. An axis of results none of which is negative is not widened below zero: it is moved up instead. `tile_min_spread: 0` switches the least off. A sentence above the tiles says what the least is.

The range is printed to the figures the axis's span calls for, `59 to 184 ng/mL` and `0.25 to 0.53 mg/L`, and on a logarithmic scale each end to three significant figures.

### How many tiles

Each tile is one Chart.js chart, drawn with the kit's Chart.js, and nothing in a tile answers the pointer: the tile does. Every biomarker is framed on its own rows of the results table, so the work grows with the table and not with the table times the number of biomarkers. The browser test named `GC-OVW-017` times the first draw of thirty-six tiles on every run, at a desk's width and at a phone's, and prints what it found.

## One biomarker over time

With a biomarker chosen and the Visit control on all visits, the chart draws that biomarker across every visit it has values at, in one picture. It is what a tile opens, what `start_value: 'IL-6'` with no `visits` opens on, and the level named `over-time`.

- Visit along the bottom, evenly spaced in visit order; at each visit the groups side by side, each in its colour, which is the colour it has on the tiles. One Chart.js chart, on one value axis named for the biomarker, its value and its unit.
- A key above names what is drawn and the groups, and a sentence under it says what a mark is.
- Under the axis, lined up with the visits, a table: the visits' names; a row per group of the number of participants drawn there; and the row of R's tests.
- A visit's name is a button, `View IL-6 at Week 4`: a click on it, or Enter or Space, or a click anywhere in that visit's part of the picture, opens that visit alone, in [the view with a visit open](#what-is-drawn), with its marks, its second grouping, its panels, its test menu and pairwise comparisons, its listing and the participant profile. All in the Visit control leads back, as does the trail above the chart.
- The picture and its table are one block. When the visits are too many for the chart's width, each less than 50 pixels wide, the block scrolls sideways inside the chart and the page does not.

The Draw as control, the setting `time_mark`, chooses among three forms:

| `time_mark`  | Draw as                    | What is drawn for a group at a visit                                                                                                            |
| ------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `box`        | Boxes                      | safety.viz's box, as with a visit open: the quartiles, a line at the median, whiskers to the 5th and 95th percentiles and a marker at the mean. |
| `mean_se`    | Means with standard errors | A point at the mean, with a bar one standard error either side, and a line per group joining its means across the visits.                       |
| `median_iqr` | Medians with quartiles     | A point at the median, with a bar from the 25th to the 75th percentile, and a line per group joining its medians across the visits.             |

The value axis covers what the form draws, with a little room: the ends of the whiskers, of the standard errors or of the quartiles. So the same biomarker's axis is narrower under means than under boxes.

Each visit's rows are the rows that visit's own view draws, one per participant from the [core's frame](core.md): nothing is pooled across visits, and a click from a visit here to that visit alone shows the same participants. The numbers describe the values drawn and compare no group with another. The quantiles and the mean are the ones a box is drawn from. The standard error is the standard deviation, R's `sd()`, over the square root of the number in the group; a group of one has a mean and no bar. On the synthetic study every count, quantile, mean, standard deviation and standard error is held to desktop R's.

Colour by and Panel by are switched off here, each with the words `Applies once a biomarker and a visit are open.`, and keep what they are set to: the picture takes no second grouping and no panels. Group by, Levels, Value, Scale, Unscheduled visits and the filters apply as they do everywhere. A group with nobody at a visit has no mark there and a count of 0; a line runs on to the group's next value.

For a change, a fold change or a percent change from one baseline visit, the baseline visit is drawn, where every group starts at no change, with a dashed line across the picture there. It is not tested, its name is not a button, and the note above the chart says so: there the value is the same for everyone. With several baseline visits a value at one of them varies, and every visit is tested and opens.

### The test under each visit

The row of tests is R's. The chart asks R once, for the whole row: the test the Test control names, between the groups drawn, at every visit, on the rows drawn there. The function is gsm.bio's `Analyze_GroupDifferenceBy`, the setting `statistic_by_visit`, each of whose rows is what `Analyze_GroupDifference` answers for that visit alone. So the p-value under a visit is the one printed when that visit is opened.

| In the row                  | When                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `p = 0.221`, `p < 0.001`    | R's p-value for that visit, printed by the [shared rule](r-connection.md#formatstatisticstatistic). Hovering it gives the whole sentence, with the method and each group's count as R used them. |
| `not tested`                | The baseline visit of a change, a fold change or a percent change. It is not sent to R.                                                                                                          |
| `not computed`              | R declined: a group there is below R's minimum size. R's reason is printed under the table, with the counts.                                                                                     |
| `error`                     | R reported an error for that visit. R's message is printed under the table.                                                                                                                      |
| `Waiting for R…`            | Across every visit, from the moment the row is asked for until R answers.                                                                                                                        |
| `Statistics unavailable`    | Across every visit, with no R attached and no stored result for the view. The picture and the counts are drawn all the same.                                                                     |
| `No test chosen`, `No test` | Across every visit, when the Test control is on None, or fewer than two groups are drawn. R is not asked.                                                                                        |

The row's heading names the test and says `p, unadjusted` or, when R adjusted, `p, adjusted (Holm)`. The Adjust across visits control, the setting `visit_adjustment`, offers None, Holm and Benjamini-Hochberg, and is None by default. It is sent to R as `strPAdjust`, by `p.adjust()`'s own name for it, and R adjusts across the visits that have a p-value; the p-values in the row are then R's adjusted ones, and the adjustment named is the one R returned with them. Nothing is adjusted here. A visit R did not compute is not a test, and is left out of the adjustment.

The groups are the same at every visit: every group drawn. A visit where one of them has nobody, or fewer than R's minimum, is not computed, and R says which group: `Week 8: Not computed: Placebo has 3. The minimum group size is 5. Counts: Placebo n = 3, Treatment n = 5.` It is never tested between the groups that happen to be there. With nobody at all in a group at a visit, R says so in the same way, `Week 12: Not computed: Placebo has 3; Treatment has 0. The minimum group size is 5.`: the group keeps its row of counts, where it reads `n = 0`, and its colour, and has no mark at that visit.

The statistics line under the table says the rest: the method as R named it, how many visits were tested, and the label, `Welch Two Sample t-test at each visit, on the participants drawn there: 5 visits tested. Exploratory, unadjusted.` or `… Exploratory, adjusted (Holm) across 5 visits.`; then R's reason for each visit it did not compute; R's own warnings and notes; and what the tests cover. Where R names the visits' tests differently, as `wilcox.test` does between an exact and an approximate p-value, each visit's whole sentence is given. There are no pairwise comparisons here: those are made with a visit open.

The two rules of [waiting, and never a stale answer](#waiting-and-never-a-stale-answer) hold: the row waits from the moment it is asked for, and an answer that arrives after the chart was drawn again is dropped. What R is sent, and the key a stored result carries, are in [what R is asked](#the-row-of-visits).

## Unscheduled visits

A results table often holds visits that were not planned: an unscheduled draw holding one participant, an early termination. Drawn beside a scheduled visit holding two hundred, such a visit says little and takes as much room. The chart leaves them out, at every level, unless they are switched on.

Which visits are unscheduled is safety.viz's rule, under the setting names safety.viz's results over time chart uses, and is the [core's](core.md#unscheduled-visits):

| Setting                     | Default                               | What it does                                                                                                      |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `unscheduled_visits`        | `false`                               | Whether unscheduled visits are drawn.                                                                             |
| `unscheduled_visit_pattern` | `'/unscheduled\|early termination/i'` | A visit is unscheduled when its name matches it.                                                                  |
| `unscheduled_visit_values`  | `null`                                | A visit is unscheduled when the list names it. When there is a list, it decides alone, whatever the pattern says. |

Left out, the results at an unscheduled visit are set aside before the chart reads anything, so such a visit:

- is in no tile, is not a visit of a biomarker over time, and is not a panel of an open biomarker;
- is not offered by the Visit control;
- is not the baseline a change is measured from: with no `baseline_visits` named, the baseline is the first scheduled visit;
- and a visit named in `visits` or `baseline_visits` is left out like any other, so name scheduled visits there.

A note above the chart says how many are left out, and which: `2 unscheduled visits not drawn: Unscheduled 1, Early Termination. Switch on Unscheduled visits to draw them.` With more than four it names the first three and counts the rest.

The Unscheduled visits control, in the Display section, switches them on, as safety.viz's results over time chart has one. It is there only when the results have a visit the rule names, so it is never a control that could do nothing; the synthetic study has none, and its demo shows neither the control nor the note. Switched on, the visits take their place in visit order in every tile, along a biomarker over time, in the Visit control and among the panels, and the note goes. A specification keeps the switch and the two settings of the rule. One that holds no `unscheduled_visits`, as every specification written by v0.2.0, takes the default: a visit it names that is unscheduled is left out, and the notice above the chart says which and that `unscheduled_visits: true` draws it.

The participant profile is safety.viz's own chart of one participant, and is given every result, unscheduled ones among them.

With unscheduled visits drawn, the rows R is handed may be framed from a table that holds them, and a baseline found among them need not be the baseline found without them. So the [identity of the rows](#what-r-is-asked) then says `unscheduled_visits: true`, for one panel and for the row of visits alike. With them left out, or with none in the results, the identity is exactly what it was before the chart knew of them.

## A cut biomarker as the groups

A biomarker, or a participant-level number, can make the groups or the panels when it is cut, by the core's shared [cut rule](core.md#the-cut-rule): at its median, its tertiles, its quartiles or typed points.

```js
BioViz.groupComparison('#chart', {
  start_value: 'IL-6',
  visits: ['Week 4'],
  value_type: 'change',
  group_by: { measure: 'CRP', visit: 'Baseline', cut: 'tertiles' },
  panel_by: { col: 'AGE', type: 'number', cut: [40, 60] }
}).init({ results, participants });
```

- The cut points are worked out on every participant the filters keep who has a value of the cut variable, whether or not they have a value to draw, so each visit's panel has the same groups. They move when the filters do.
- The groups are ordered low to high and labelled with their bounds (`≤ 2.167`, `> 2.167, ≤ 3.467`, `> 3.467`), with the number in each beneath, as for a column. A group nobody is in is not drawn.
- The footnote says how the variable was cut: `CRP at Baseline is cut at its tertiles, 2.167 and 3.467, worked out on the 200 participants with a value.` When repeated points collapse, or points written alike merge groups, it says so and how many groups they make.
- A participant with no value of the cut variable is left out and counted, as for a column.
- The Group and Panel controls offer the cut variable after the columns, named in words (`CRP at Baseline, cut at the tertiles`). A cut has no Levels control: every group it makes is drawn.
- The colour is a column only.
- R is asked for the test of the cut groups as for a column's, with the cut variable in the identity of the rows and the groups named low to high (see [What R is asked](#what-r-is-asked)).
- A cut of a biomarker the results table does not have, or of a column neither table has, is refused when the tables are read, with a message that names the setting and what it cuts.
- When distinct points are written alike to four significant digits, the groups with the same bounds are one, and the footnote says so. Typed points written alike are refused.

## The controls

In safety.viz's sidebar, in five sections.

| Section    | Control              | What it sets                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Value      | Biomarker            | All Biomarkers, which is the trend tiles, or one biomarker.                                                                                                                                                                                                                                                               |
| Value      | Value                | The value type: result, baseline, change, fold change or percent change from baseline.                                                                                                                                                                                                                                    |
| Value      | Visit                | The visit, or visits. With one biomarker open, only the visits that biomarker has values at, in visit order; on the tiles, every visit. All of them is the biomarker over time, and fewer are a panel each. An unscheduled visit is offered only when they are drawn. Not shown for a baseline value, which has no visit. |
| Groups     | Group by             | The column on the axis.                                                                                                                                                                                                                                                                                                   |
| Groups     | Levels               | Which of its levels are drawn.                                                                                                                                                                                                                                                                                            |
| Groups     | Colour by            | The second grouping, or none. Switched off on the tiles and over time.                                                                                                                                                                                                                                                    |
| Groups     | Panel by             | The variable the panels are made by, or none. Switched off on the tiles and over time.                                                                                                                                                                                                                                    |
| Display    | Tiles draw           | Medians or means: what a tile's lines go through. Only on the tiles.                                                                                                                                                                                                                                                      |
| Display    | Draw as              | With a visit open: box, violin or points. Over time: boxes, means with standard errors or medians with quartiles. Switched off on the tiles.                                                                                                                                                                              |
| Display    | Scale                | Linear or logarithmic.                                                                                                                                                                                                                                                                                                    |
| Display    | Unscheduled visits   | Whether [unscheduled visits](#unscheduled-visits) are drawn. Only when the results have one.                                                                                                                                                                                                                              |
| Statistics | Test                 | The test R is asked for, from the ones that fit the number of groups drawn, or none.                                                                                                                                                                                                                                      |
| Statistics | Pairwise comparisons | Whether every pair of groups is compared as well. Shown with a visit open and more than two groups.                                                                                                                                                                                                                       |
| Statistics | Adjust across visits | How R adjusts the p-values across the visits: none, Holm or Benjamini-Hochberg. Only over time.                                                                                                                                                                                                                           |
| Filters    | one per filter       | The participants drawn. Only with a participant table.                                                                                                                                                                                                                                                                    |
|            | Reset chart          | Returns every control to what the chart opened on.                                                                                                                                                                                                                                                                        |

The Statistics section is there when the setting `statistic` names a function and one biomarker is open; over time it also needs `statistic_by_visit`. There is no control that chooses a confidence level or a minimum group size: those are R's. The one adjustment a control chooses is across the visits of a biomarker over time, and R makes it. A cut is chosen in the settings, as part of the variable that makes the groups.

## Listing and participant profile

Clicking a box or a violin lists its participants under the chart, in safety.viz's record listing, with its search, its sorting, its paging and a CSV export. Clicking a point lists that participant and opens their profile. A change to a control or a filter empties the list, so it never lists a box that is no longer drawn.

Clicking a row selects that participant. The chart then raises the event safety.viz's charts raise, `participantsSelected`, on its own root element, and the event bubbles: `event.detail.data` is a list holding the participant's id, or an empty list when the selection is cleared. safety.viz's participant profile opens on that event, in a rail beside the chart, and any other chart on the page can listen for it.

The profile was made for laboratory results that carry a reference range. For results that have one, name its columns in `normal_col_high` and `normal_col_low`. For results that have none, as biomarker results often do, the profile shows each biomarker as a multiple of the participant's first result, and no reference range is drawn or implied. Its time axis is a study day: name the column that holds it in `studyday_col`.

## The statistics line

Under each panel of the view with a visit open; [the trend tiles](#the-trend-tiles) have none, and [one biomarker over time](#the-test-under-each-visit) has a row of tests in the table under its picture and one line beneath. The chart computes no test, no estimate, no interval, no p-value and no adjustment. It chooses which test to ask R for, hands R the rows of the panel through the connection in the setting `connection`, and prints what R returns through the formatters every chart shares: [`formatStatistic`, `formatEstimate` and `formatComparison`](r-connection.md#formatstatisticstatistic). With no connection given the chart makes one with no R attached, and the line reads `Statistics are unavailable: no R is attached to this chart.`

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
| `chrGroups`   | Only when the groups are a cut variable's: the groups in the panel's rows, low to high.                  |

Nothing else is sent. A column's groups are the ones in the rows, in the order R sorts them; a cut's are named, low to high, so R's result lists them in the order they are drawn and a difference in means is of the lower group minus the higher; the adjustment, the confidence level and the minimum group size are gsm.bio's defaults, and each is printed from what R returns.

`dataId` states what the rows are. A [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together, so the identity is built only from what the settings and the controls say, by the settings' own names, and from the group names in the rows:

| Member               | Value                                                                                                                                                                     | Left out when                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `chart`              | `'group-comparison'`.                                                                                                                                                     | never                                       |
| `measure`            | The biomarker.                                                                                                                                                            | never                                       |
| `value_type`         | `raw`, `baseline`, `change`, `fold_change` or `percent_change`.                                                                                                           | never                                       |
| `visit`              | The panel's visit.                                                                                                                                                        | the value type is `baseline`                |
| `baseline_visits`    | The setting, as a list.                                                                                                                                                   | the setting is null                         |
| `baseline_stat`      | The setting.                                                                                                                                                              | never                                       |
| `group_by`           | The column on the axis, or the cut variable as the settings write it: `{ measure, visit, value, cut }`, the visit left out for a baseline value, or `{ col, type, cut }`. | never, for a panel that has a test          |
| `groups`             | The distinct values of `x` in the rows, as text, sorted by code point.                                                                                                    | never                                       |
| `color_by`           | The colour column.                                                                                                                                                        | there is no colour                          |
| `panel_by`           | The panel column, or the cut variable, written as `group_by` writes one.                                                                                                  | there are no panels by a variable           |
| `panel`              | The panel's level of that column, or the label of its group of the cut.                                                                                                   | there are no panels by a variable           |
| `filters`            | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point.                                                     | no filter is in force                       |
| `positive_only`      | `true` on a logarithmic scale, where a value of zero or less is left out.                                                                                                 | the scale is linear                         |
| `unscheduled_visits` | `true` when [unscheduled visits](#unscheduled-visits) are drawn and the results have some, so the rows were framed from a table that holds them.                          | they are left out, or the results have none |

A member that is not set is left out, never written as null. A list is a list whatever its length. Sorting by code point is what R's `sort(x, method = "radix")` does, so both sides write the same list without a locale.

`chart.statistics()` returns what the chart has asked for the panels now drawn, one entry per panel that asked: `{ panel, name, args, dataId, rows, answer }`, where `rows` is the number of rows handed over and `answer` is what the connection resolved to, or null while R has not answered. It is the key a stored result must carry, read from the chart itself. One biomarker over time is one entry, whose `panel` is empty.

#### The row of visits

For one biomarker over time, one call for every visit:

```js
connection.run('Analyze_GroupDifferenceBy', {
  data, // one row per participant and visit: the participant's id, `y`, `x` and `visit`
  args: {
    strValueCol: 'y',
    strGroupCol: 'x',
    strByCol: 'visit',
    strMethod: 't',
    chrBy: ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'],
    strPAdjust: 'none'
  },
  dataId // what the rows are: see below
});
```

The rows are long: each visit's rows are the rows that visit's own panel hands R, with the visit named in `visit`, in visit order. The baseline visit of a change, a fold change or a percent change from one baseline visit is not among them, and is in neither `chrBy` nor the identity.

| Argument      | Value                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `strValueCol` | Always `'y'`.                                                                                                                     |
| `strGroupCol` | Always `'x'`.                                                                                                                     |
| `strByCol`    | Always `'visit'`.                                                                                                                 |
| `strMethod`   | The test asked for: `'t'`, `'wilcoxon'`, `'anova'` or `'kruskal'`.                                                                |
| `chrBy`       | The visits tested, in visit order, so R answers them in that order. Always sent.                                                  |
| `strPAdjust`  | The adjustment across the visits, by `p.adjust()`'s name: `'none'`, `'holm'` or `'BH'`. Always sent, `'none'` when there is none. |
| `chrGroups`   | Only when the groups are a cut variable's: the groups drawn, low to high.                                                         |

Nothing else is sent. As for one panel, a column's groups are left to R, which takes every group in the rows, the same at every visit, and sorts them by code point; a cut's are named low to high. No pairwise comparison is asked for, and the confidence level and the minimum group size are gsm.bio's defaults.

The identity is the one a panel has, with the visits tested in place of one visit, and with no colour and no panel, which the picture does not take:

| Member               | Value                                                                  | Left out when                               |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `chart`              | `'group-comparison'`.                                                  | never                                       |
| `measure`            | The biomarker.                                                         | never                                       |
| `value_type`         | `raw`, `change`, `fold_change` or `percent_change`.                    | never                                       |
| `visits`             | The visits tested, as a list in visit order: the same list as `chrBy`. | never                                       |
| `baseline_visits`    | The setting, as a list.                                                | the setting is null                         |
| `baseline_stat`      | The setting.                                                           | never                                       |
| `group_by`           | The column the groups come from, or the cut variable, as for a panel.  | never, when there is a test                 |
| `groups`             | The distinct values of `x` in the rows, as text, sorted by code point. | never                                       |
| `filters`            | As for a panel.                                                        | no filter is in force                       |
| `positive_only`      | `true` on a logarithmic scale.                                         | the scale is linear                         |
| `unscheduled_visits` | `true` when unscheduled visits are drawn and the results have some.    | they are left out, or the results have none |

The members are written in that order. It has `visits`, a list, where a panel's identity has `visit`, one name; with the function's name, that keeps the two apart, and a stored result for one is never found for the other.

### Stored results, from R

A page that ships R's answers gives the chart a connection with `results`: one stored result per panel of the views it computed, and one per biomarker over time, for the test and the adjustment it was computed with. One biomarker at a few visits is several panels, and so several stored results, each with its own `visit`; the same biomarker over time is one, with its `visits`. A view with no stored result reads `Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.` It is never answered with another view's numbers: a different test, pairwise switch, biomarker, visit, value type, group, colour, panel or filter is a different key.

In R, the key of one panel's stored result, from the panel's rows and what the view is set to:

```r
# dfRows: the panel's rows, one per participant: the id, y, x (and color, panel when set).
# lView:  the view, by the chart's names; a member that is not set is NULL.

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
# A member that is a list is an unnamed list, so it is written as a JSON array
# whatever its length. Text is sorted by code point (`method = "radix"`), which
# is the order the chart sorts in. A cut's groups are handed to R low to high,
# the order of the levels cut() made, so R names them in that order; a column's
# are left to R, which sorts them by code point.
group_comparison_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(chart_text(dfRows$x)), method = "radix")
  lDataId <- list(chart = "group-comparison", measure = chart_text(lView$measure), value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- chart_text(lView$visit)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (!is.null(lView$color_by)) lDataId$color_by <- lView$color_by
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- chart_text(lView$panel)
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  # Unscheduled visits are drawn, and the results have some.
  if (isTRUE(lView$unscheduled_visits)) lDataId$unscheduled_visits <- TRUE
  lArgs <- list(
    strValueCol = "y",
    strGroupCol = "x",
    strMethod = lView$test,
    # Pairs exist only among more than two groups.
    bPairwise = isTRUE(lView$pairwise) && length(chrGroups) > 2
  )
  if (is.list(lView$group_by)) {
    if (!is.factor(dfRows$x)) stop("the groups of a cut variable must be the factor cut() made")
    lArgs$chrGroups <- as.list(levels(droplevels(dfRows$x)))
  }
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfRows))
}

lKey <- group_comparison_key(dfRows, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfRows), lKey$args))))
```

And the key of the stored result for one biomarker over time, the row of visits, from the long rows:

```r
# dfRows: the rows of every visit tested, one per participant and visit: the id,
#         y, x and visit, each the row of that visit's own panel, in visit order.
# lView:  the view, by the chart's names: statistic_by_visit, test,
#         visit_adjustment, measure, value_type, visits (the visits tested, in
#         visit order: every visit the biomarker has values at, without the
#         baseline visit when the value is a change, a fold change or a percent
#         change from one baseline visit), baseline_visits, baseline_stat,
#         group_by, filters, y_scale, unscheduled_visits.
group_comparison_by_visit_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(chart_text(dfRows$x)), method = "radix")
  chrVisits <- chart_text(lView$visits)
  lDataId <- list(chart = "group-comparison", measure = chart_text(lView$measure), value_type = lView$value_type)
  lDataId$visits <- as.list(chrVisits)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  if (isTRUE(lView$unscheduled_visits)) lDataId$unscheduled_visits <- TRUE
  lArgs <- list(
    strValueCol = "y",
    strGroupCol = "x",
    strByCol = "visit",
    strMethod = lView$test,
    chrBy = as.list(chrVisits),
    strPAdjust = lView$visit_adjustment
  )
  if (is.list(lView$group_by)) {
    if (!is.factor(dfRows$x)) stop("the groups of a cut variable must be the factor cut() made")
    lArgs$chrGroups <- as.list(levels(droplevels(dfRows$x)))
  }
  list(name = lView$statistic_by_visit, args = lArgs, dataId = lDataId, rows = nrow(dfRows))
}

lKey <- group_comparison_by_visit_key(dfRows, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfRows), lapply(lKey$args, unlist)))))
```

When the groups are a cut variable's, `lView$group_by` is the cut variable as a named list, typed points as a list (`list(measure = "CRP", visit = "Baseline", value = "raw", cut = list(10))`), and `dfRows$x` is the factor the [cut rule](core.md#the-cut-rule)'s `cut()` made, whose levels are the groups low to high. `lView$test` is the test asked for, which is the setting `test` where it fits the number of groups on the axis and its counterpart where it does not. `lView$filters` is a named list of column to the values the filter lets through. `lView$unscheduled_visits` is `TRUE` only when the chart draws unscheduled visits and the results have some; `dfRows` is then framed from every result, and otherwise from the results at scheduled visits alone. Written to JSON, a single value is a single value and an unnamed list is an array (`jsonlite::toJSON(auto_unbox = TRUE)`), and the value is in [the shape the browser form gives](r-connection.md#stored-results).

These are the functions `tools/r-group-statistics.R` writes the chart's expected results with. The unit tests named `GC-STAT-023` hold the key the first writes, for eighteen panels of the gallery's demo, to the key the chart asks with, and hand its results to a connection as stored results to see each one found; the tests named `GC-TIME-013` do the same for the second, for ten views of IL-6 over time, and `GC-TIME-014` holds each visit's p-value in R's one answer to what R gives when that visit is asked alone, and the adjusted one to `p.adjust()` of those.

### In the browser

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, as the connection's `browser.sourceUrl`. This repository keeps a copy at `site/vendor/gsm.bio/statistics.R`, with a record of the gsm.bio commit it was copied from, and the site publishes it at `vendor/gsm.bio/statistics.R`. The file is sourced with base R alone. It names the survival package only inside its survival functions, which this chart never calls, so a page that draws only this chart installs no package: `browser: { sourceUrl, packages: [] }`.

Nothing is fetched until the chart first asks for a test, which is the first time it draws a panel that prints one. A chart that opens on the trend tiles, as it does by default, asks for nothing until a biomarker is opened; so does one that opens with `test: 'none'`, until the reader chooses a test. Opening a biomarker over its five visits asks once, for the whole row. A biomarker at a few visits asks once per panel: R is started once for all of them, each panel waits and is answered for itself, and the page goes on answering clicks while they arrive. The `waiting_note` is said by the first that waits, not by every one.

The answers are checked against desktop R. `tools/r-group-statistics.R` sources the same vendored file in desktop R, runs it on rows the chart's own code wrote, and writes `tests/fixtures/group-statistics-r.json` with the R version that made it. The browser tests named `GC-STAT-034` to `GC-STAT-042` and `GC-OVW-019` run the gallery's chart against real R in the browser and hold every number to that file within 1 part in 10^8, the row of tests under IL-6 over time among them, unadjusted and adjusted. R in the browser is a newer R than the desktop one that wrote the file, and R's own answer differs between them in one known case: with tied values and fewer than 50 in each group, `wilcox.test` in R 4.3 warns and approximates where R 4.6 computes the exact p-value. Where that happens the tests compare every other number and print both versions' numbers side by side; the tolerance is not widened.

## On a phone

Below 900 pixels of width safety.viz's shell stacks: the controls above the chart, the participant profile below it. Below 600 pixels the controls start folded away, so the chart is on the first screen, and one tap on Controls opens them. Panels drop to one column. The listing wraps its cells instead of running off the page.

The trend tiles sit two to a line, each whole, with its range beneath. A tap on a tile opens the biomarker, and the page is brought back to the chart's top. The Biomarker control, one tap away under Controls, lists every biomarker and leads back to all of them.

One biomarker over time keeps its picture and the table under it lined up at any width. Five visits fit a phone's width; more scroll sideways inside the chart, the picture and the table together, and the page stays still. A tap on a visit's name opens that visit, and the trail above the chart leads back.

## What is not here

No statistical test, estimate, interval, p-value or adjustment is computed here: the chart chooses which of R's to ask for and prints R's answer. A cut point describes the values, as a box's median does, and is the core's shared [cut rule](core.md#the-cut-rule).
