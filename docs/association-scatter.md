# The association scatter

Do these two variables move together? The chart draws one point per participant, with a variable on each axis: a biomarker at a visit, as its result or any value type worked out from its baseline, or a participant-level number. Points take a colour from a group, panels come from one further variable, and each axis can be logarithmic. Dragging across the points lists the participants in a region, and clicking a point opens that participant's profile.

It draws; it does not estimate. The line under the chart is where a correlation coefficient is printed, with its interval and p-value, and that coefficient is computed by R: the chart chooses which to ask for, hands R the rows it drew through the [connection to R](r-connection.md), and prints what R returns. A fitted line over the points is R's as well, point by point. The one line the chart draws by itself is y = x, which is not an estimate of anything. With no R attached the points and that line still draw, and the chart says that statistics are unavailable.

It is built the way the [group comparison chart](group-comparison.md) is, from the same parts, and takes the same tables and the same column settings. It does not replace safety.viz's shift plot, which is one measure at two visits, or its delta-delta, which is change against change: neither reports a correlation.

## At a glance

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  const chart = BioViz.associationScatter('#chart', {
    x: { measure: 'TNF-alpha', visit: 'Baseline' },
    y: { measure: 'IL-10', visit: 'Baseline' },
    color_by: 'ARM',
    fit: 'linear',
    // R, started in the browser the first time a statistic is asked for. Leave
    // it out and the line under the chart says that statistics are unavailable.
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

## What the page loads

Two script tags, safety.viz's first. The chart is built from safety.viz's kit (`SafetyViz.kit`): its control sidebar, its filters, its record listing, its participant profile and its Chart.js. bio.viz bundles none of it and no Chart.js of its own; it finds the kit on the page when a chart is made, and says so plainly if it is not there.

## `associationScatter(element, settings)`

Makes a chart in an element and returns it. `element` is the element, or a CSS selector for it. `settings` is laid over the [defaults](#settings) and may be left out. The controls are drawn at once; nothing else is drawn until the chart is given its tables.

A setting that is not known, or a value a setting cannot take, is refused: `associationScatter` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants }`, each an array of records, one object per row. They are the tables the [core](core.md) reads, and the column settings are the core's.

| Table          | Required | One row per                   | What it adds                                                                        |
| -------------- | -------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `results`      | yes      | participant, biomarker, visit | The biomarkers an axis can take.                                                    |
| `participants` | no       | participant                   | Filters, participant-level numbers for an axis, and columns to colour and panel by. |

Only the results table is required. With it alone the chart has no filters, and a colour, a panel or a participant-level number comes from a column carried on the results rows: one that is not mapped by a setting and holds one value for each participant. When the results rows carry no such column the chart offers no colour and no panel, and every axis is a biomarker.

With a participant table the chart shows a filter for each of its category columns, offers those columns to colour and panel by, and offers its numeric columns on either axis. A category column is one with at most `max_levels` different values. A filter chooses participants: the ones filtered out are not drawn, and are not counted as missing a result. When the filters together let nobody through, the chart draws nothing, asks R for nothing and reads `No participant passes the filters.`, the words every chart uses; loosen a filter and it draws again.

A participant table is matched to the results by the participant's id, in the column `participant_id_col` names, or `id_col`'s when that is not set. A participant table without that column is refused, with a message that names the column. A participant the results have and the participant table does not is left out and counted (`Not in the participant table`), and so is a row of results with no participant id (`Row has no participant id`). If drawing fails for any other reason, the footnote says `This chart could not be drawn:` and why, nothing half drawn is left, and the controls stay.

## A variable on an axis

An axis is a variable, written as the [core writes one](core.md#variablespec):

| Written                                                 | What it is                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `{ measure: 'IL-6', visit: 'Week 4' }`                  | A biomarker's result at a visit.                                                    |
| `{ measure: 'IL-6', visit: 'Week 4', value: 'change' }` | A value type at a visit: `change`, `fold_change` or `percent_change` from baseline. |
| `{ measure: 'IL-6', value: 'baseline' }`                | A baseline value, which has no visit.                                               |
| `{ col: 'AGE' }`                                        | A participant-level number. The column is read as a number.                         |

The rows of every panel are one [frame](core.md#frametables-variables-settings) from the core, with x and y as two variables. A participant for whom either cannot be worked out is left out, and the note above the chart counts them by the core's reason and by the axis: `13 left out: No result at the visit (x axis).` The same note says how many are drawn of how many: `186 of 200 participants drawn.`

The participant-level numbers offered are the columns in which every written value is a number and more than one value occurs; the setting `numbers` names them instead, with labels.

A change, a fold change or a percent change read at the one baseline visit is the same for every participant by definition, so there is nothing to relate: the chart says so and asks for a later visit.

## The chart's methods

The lifecycle is safety.viz's, so a page drives both libraries the same way. `init`, `setData`, `setSettings`, `brush` and `clearBrush` return the chart, so calls can be chained.

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
| `chart.brush(region)`           | Selects a region, as a drag does: `{ x: [from, to], y: [from, to] }` in the values' own units, with `panel`, a panel's title, when there are panels.                                                                                                                                                                                                                                                                  |
| `chart.clearBrush()`            | Lets go of the region and empties the listing.                                                                                                                                                                                                                                                                                                                                                                        |
| `chart.view()`                  | What the controls are set to, as settings: `x`, `y`, `color_by`, `panel_by`, `x_scale`, `y_scale`, `fit` and `method`.                                                                                                                                                                                                                                                                                                |

Tables the chart cannot read (not arrays of records, or a results table without one of its mapped columns) are refused: `setData` throws a `TypeError`, and the message is shown in the chart's element.

## Settings

Every setting, with its default. The column settings and the baseline settings are the [core's](core.md#default_settings), under the same names, and a setting the group comparison chart also has is named as it is there.

| Setting              | Default                 | Meaning                                                                                                                                                                 |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`             | The participant's id, in the results table.                                                                                                                             |
| `measure_col`        | `'TEST'`                | The biomarker's name.                                                                                                                                                   |
| `value_col`          | `'STRESN'`              | The result.                                                                                                                                                             |
| `visit_col`          | `'VISIT'`               | The visit's name.                                                                                                                                                       |
| `visit_order_col`    | `'VISITNUM'`            | A number that orders the visits. May be null.                                                                                                                           |
| `unit_col`           | `'STRESU'`              | The unit of the result, printed in an axis's title. May be null.                                                                                                        |
| `participant_id_col` | `null`                  | The participant's id in the participant table, when it is not named as `id_col` is.                                                                                     |
| `baseline_visits`    | `null`                  | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                                       |
| `baseline_stat`      | `'mean'`                | How several baseline visits are brought to one value: `mean`, `min`, `max` or `first`.                                                                                  |
| `x`                  | `null`                  | The variable on the x axis, [as written above](#a-variable-on-an-axis). Null means the first biomarker at the first visit; so does a variable the tables do not have.   |
| `y`                  | `null`                  | The variable on the y axis. Null means the second biomarker at the first visit; see [what it opens on](#what-it-opens-on).                                              |
| `color_by`           | `null`                  | The column the points are coloured by. Null means none.                                                                                                                 |
| `panel_by`           | `null`                  | The column the panels are made by. Null means none.                                                                                                                     |
| `x_scale`            | `'linear'`              | The scale of the x axis: `linear` or `log`.                                                                                                                             |
| `y_scale`            | `'linear'`              | The scale of the y axis: `linear` or `log`.                                                                                                                             |
| `fit`                | `'none'`                | The line over the points: `none`, `identity`, `linear` or `smooth`. See [the fitted line](#the-fitted-line).                                                            |
| `measures`           | `null`                  | The biomarkers an axis's Variable control offers, in this order. Null means every biomarker in the table, by name.                                                      |
| `numbers`            | `null`                  | The participant-level numbers an axis offers, as names or `{ value_col, label }`. Null means the numeric columns the tables have.                                       |
| `groups`             | `null`                  | The columns offered to colour and panel by, as names or `{ value_col, label }`. Null means the category columns the tables have.                                        |
| `max_levels`         | `12`                    | The most different values a column may hold and still be offered as a category.                                                                                         |
| `filters`            | `null`                  | The filters, as names or `{ value_col, label }`, with safety.viz's `start`, `all` and `multiple`. Null means every category column of the participant table.            |
| `details`            | `null`                  | The columns of the listing, as names or `{ value_col, label }`. Null means the participant, the two values drawn, the colour and the panel.                             |
| `page_size`          | `10`                    | Rows on a page of the listing.                                                                                                                                          |
| `connection`         | `null`                  | The connection to R the chart asks. Null means one with no R attached.                                                                                                  |
| `statistic`          | `'Analyze_Correlation'` | The R function the statistics line asks for: gsm.bio's, or one that takes the same arguments. Null means no statistics line and no Method control.                      |
| `method`             | `'pearson'`             | The coefficient the chart opens on: `pearson` or `spearman`.                                                                                                            |
| `fit_statistic`      | `'Analyze_Fit'`         | The R function a linear fit or a smooth is asked of: gsm.bio's, or one that takes the same arguments. Null means the Fitted line control offers only none and identity. |
| `waiting_note`       | `null`                  | A sentence added to the waiting text until R has answered once: what starting R costs on this page. Null means none.                                                    |
| `back`               | `null`                  | A way back, for a chart that opened this one: `{ label, action }`. See [opened by another chart](#opened-by-another-chart).                                             |
| `profile`            | `true`                  | Whether a point, or a row of the listing, opens safety.viz's participant profile.                                                                                       |
| `profile_details`    | `null`                  | The participant's columns shown at the head of the profile. Null means the category columns.                                                                            |
| `studyday_col`       | `null`                  | A column of the results table holding the study day of each result: the time axis of the profile. Without it the profile draws no lines over time.                      |
| `normal_col_high`    | `null`                  | A column holding the upper limit of normal of each result, when the results have one.                                                                                   |
| `normal_col_low`     | `null`                  | A column holding the lower limit of normal.                                                                                                                             |
| `title`              | `null`                  | The title above the chart: text with placeholders such as `{n}`, filled from the view drawn ([titles and footnotes](#titles-and-footnotes)). Null means none.           |
| `subtitle`           | `null`                  | The line under the title, written the same way. Null means none.                                                                                                        |
| `footnotes`          | `null`                  | Footnotes under the chart: text, or a list of texts, with placeholders. The chart's own footnote is always last. Null means none but that one.                          |
| `downloads`          | `true`                  | Whether the downloads are offered under the chart: the PNG, the statistics and the table ([downloads](#downloads)).                                                     |
| `png_scale`          | `2`                     | The PNG's resolution: image pixels per CSS pixel, from 1 to 4. At 2 the picture is twice the size it is drawn on the page, 192 pixels to the inch.                      |

There is no setting that chooses a confidence level, a minimum number of pairs, an adjustment or how smooth a smooth is: those are R's.

### What it opens on

With `x` and `y` named, the chart opens on that pair. With neither named it opens on the first two biomarkers of the Variable control at the first visit, as their results: x the first, y the second. With one biomarker in the table, y is that biomarker at the second visit; with one visit as well, the first participant-level number; with nothing else, the same variable as x. A variable that is named and that the tables do not have gives way to these, and the chart says so in the console.

`setSettings({ x, y })` opens another pair in place: the two Variable controls move, the chart is drawn again and R is asked again. It is how a page, or another chart, points this one at a pair it names.

## Titles and footnotes

The settings `title`, `subtitle` and `footnotes` are text with named placeholders, filled from the view drawn each time the chart draws. A placeholder is a name in braces, and it is replaced by text: nothing in a setting or a value is evaluated, and a name the chart does not have is left as written. The title and the subtitle are drawn above the chart, and the footnotes under it; the chart's own footnote, always last, says when and by what it was drawn and what stands behind each statistic printed. The rules are in [Getting results out](output.md).

| Placeholder | What it holds                              |
| ----------- | ------------------------------------------ |
| `{x}`       | The horizontal axis, as its title reads.   |
| `{y}`       | The vertical axis, as its title reads.     |
| `{n}`       | How many participants are drawn.           |
| `{filters}` | The filters in force, in words, or `none`. |
| `{date}`    | The date drawn, in UTC: `2026-10-04`.      |
| `{version}` | The bio.viz version.                       |

## Downloads

Under the footnotes a bar offers three downloads, each saved as a file named for the chart and the view, such as `bio.viz-association-scatter-….png`:

| Download         | What it holds                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG              | The chart's frame as a picture: the title and subtitle, the notes, what the chart draws, the statistics line and the footnotes, the chart's own last, at `png_scale` image pixels per CSS pixel. The file carries its title, its footnotes and its resolution in its own text and size chunks. The controls, the listing and the bar are left out. |
| Statistics (CSV) | The statistics R returned for the view, as shown: a row for each answer's result and one for each of its parts, every number as R returned it. Offered once R has answered.                                                                                                                                                                        |
| Table (CSV)      | The table the chart drew from: one row per participant drawn: the participant, the two values drawn, and the colour and the panel where there are any.                                                                                                                                                                                             |

A CSV file is written by RFC 4180: a field, or a heading, that holds a comma, a double quote or a line break is quoted. `chart.fileOf(kind)` gives the same file without saving it: a promise of `{ name, blob }`, for `kind` `'png'`, `'statistics'` or `'table'`. The format of each file is in [Getting results out](output.md#downloads).

## What is drawn

Each panel is one Chart.js chart: one point per participant, at its two values. Each axis is named for its variable, with its unit. A colour gives each of its levels a colour and a key; the key does not switch a level off, because the coefficient beneath is of every point drawn. Panels by one further variable give one panel per level of it, all on the same two axes, each with its own count and its own statistics line.

An axis runs from the least value drawn to the greatest, with a little room. On a logarithmic axis a value of zero or less cannot be shown: it is left out, and the note above the chart counts how many were, for each axis.

## The controls

In safety.viz's sidebar.

| Section    | Control        | What it sets                                                                                            |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| X axis     | Variable       | A biomarker, or a participant-level number.                                                             |
| X axis     | Value          | For a biomarker, its value type: result, baseline, change, fold change or percent change from baseline. |
| X axis     | Visit          | For a biomarker, the visit. Not shown for a baseline value, which has no visit.                         |
| X axis     | Scale          | Linear or logarithmic.                                                                                  |
| Y axis     | the same four  | The same, for the y axis.                                                                               |
| Groups     | Colour by      | The column the points are coloured by, or none.                                                         |
| Groups     | Panel by       | The variable the panels are made by, or none.                                                           |
| Display    | Fitted line    | None, identity, linear or smooth.                                                                       |
| Statistics | Method         | Pearson or Spearman.                                                                                    |
| Filters    | one per filter | The participants drawn. Only with a participant table.                                                  |
|            | Reset chart    | Returns every control to what the chart opened on.                                                      |

The Groups section is there when a column can make a group, and the Statistics section when the setting `statistic` names a function.

## The statistics line

Under each panel. The chart computes no coefficient, no interval, no p-value and no adjustment. It hands R the rows of the panel through the connection in the setting `connection` and prints what R returns through the formatters every chart shares: [`formatStatistic`, `formatEstimate` and `formatGroup`](r-connection.md#formatstatisticstatistic). With no connection given the chart makes one with no R attached, and the line reads `Statistics are unavailable: no R is attached to this chart.`

The function is gsm.bio's `Analyze_Correlation`, which is R's own `cor.test`. The Method control, the setting `method`, chooses Pearson's coefficient or Spearman's.

### What is printed

| Part                   | Where it comes from              | Example                                                                                                        |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The result             | `method`, `p_value`, `counts`    | `Pearson's product-moment correlation: p < 0.001 (n = 200). Exploratory, unadjusted.`                          |
| The coefficient        | the row of `estimates`           | `Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.`                                               |
| Within each colour     | `rows`                           | A table: each level, its count, its coefficient with its interval, and its p-value, captioned with the method. |
| What R said            | `warnings`, `notes`              | `R warned: Cannot compute exact p-value with ties`                                                             |
| The scale              | the chart, on a logarithmic axis | See [a logarithmic axis](#a-logarithmic-axis).                                                                 |
| What the result covers | the chart                        | `This coefficient is of the 200 participants drawn.`                                                           |

R names the coefficient `cor` or `rho`; the chart prints `Pearson’s r` and `Spearman’s rho` for those two names and any other name as R gave it. Numbers other than a p-value are printed to four significant figures; a p-value is printed by the [shared rule](r-connection.md#formatstatisticstatistic). Nothing is rounded before it is printed, and no printed number is worked out here.

For Spearman's coefficient R's `cor.test` gives no interval, so none is printed and none is made up; R's note says so on the line: `R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported.`

With a colour, R also returns the coefficient within each level, and the chart prints them as a small table under the coefficient of everyone drawn. The levels are not adjusted for one another, and the caption says so. A level with too few pairs prints R's reason in its row and no number.

Too few pairs in the panel as a whole prints R's reason, once, and no number: `Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.` The minimum is R's. A result R marks as an error prints R's message after `R reported an error:`. There are no stars, and the word significant is never printed.

### What one coefficient covers

One coefficient per panel, on that panel's rows: the participants drawn in it, one row each. With panels, each asks for itself and is answered for itself, and the coefficients are not adjusted for one another. A filter narrows the rows, and so the coefficient. The line says so under each result: `This coefficient is of the 91 participants drawn in this panel (F). Each panel has a coefficient of its own, and they are not adjusted for one another. Filters: Response is Responder.`

A region selected by a drag is not part of it: see [a region](#a-region-the-listing-and-the-participant-profile).

### A logarithmic axis

On a logarithmic axis R is handed the base-10 logarithm of that axis's values: the values as plotted. So Pearson's coefficient there is the coefficient of the logarithms, and a linear fit is a straight line on the picture. Taking a logarithm is arithmetic on one value, not inference, and it is the only thing done to a value before R has it. Spearman's coefficient is computed on ranks, which a logarithm does not change, so it is the same on either scale.

The line says which scale a statistic was computed on every time an axis is logarithmic, under the result:

| Asked        | Said, with the x axis logarithmic                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pearson      | `The x axis is logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L). Pearson’s coefficient is of the values as plotted, not of the values themselves.` |
| Spearman     | `… Spearman’s coefficient is computed on ranks, which a logarithm does not change.`                                                                                        |
| A linear fit | `… The line is fitted to the values as plotted, so it is straight on these axes, and its slope and intercept are of the logarithms.`                                       |
| A smooth     | `… The curve is fitted to the values as plotted.`                                                                                                                          |

With both axes logarithmic it begins `Both axes are logarithmic` and names both variables. The scale is part of the identity of the rows, so a result stored for one scale never answers for the other.

### Waiting, and never a stale answer

Two rules keep a wrong number from standing under a chart, the same two the group comparison chart keeps:

- From the moment a result is asked for until it arrives, the line reads `Statistics: waiting for R…`, and a fitted line `Fitted line: waiting for R…`. Until R has answered once, the setting `waiting_note` is added: a page says there what starting R costs.
- Every time the chart is drawn the line and the fitted line are cleared and asked for again, and an answer that was asked for before the chart was last drawn is dropped when it arrives. A change to a variable, a value type, a visit, a scale, the colour, the panels, the method, the fitted line or a filter draws the chart again. Neither ever shows an answer for rows other than the ones on screen.

## The fitted line

The Fitted line control, the setting `fit`.

| Choice     | What is drawn                                                             | Who computes it                |
| ---------- | ------------------------------------------------------------------------- | ------------------------------ |
| `none`     | Nothing.                                                                  |                                |
| `identity` | The line y = x, dashed, across the part of the two axes they share.       | Nobody: it is not an estimate. |
| `linear`   | R's straight line of y on x, with the confidence band of its fitted mean. | R: `lm()` and `predict()`.     |
| `smooth`   | R's local regression of y on x, with its pointwise band.                  | R: `loess()` and `predict()`.  |

The identity line needs no R and asks for nothing. It is a straight line whenever the two axes have the same scale; with one logarithmic and one linear it is the same line, which is then a curve. Where the two axes share no value there is no part of it to draw.

A linear fit and a smooth are gsm.bio's `Analyze_Fit`, asked through the connection on the same rows as the coefficient. R returns the line as points, fifty by default, each with its lower and upper band; the chart joins exactly those points with straight segments and fills between the two bands. It works out no point of a line, a curve or a band. On a logarithmic axis R's points are logarithms, and each is put back on the axis's own scale to be drawn.

With no colour the line of every point drawn is dark, with its band. With a colour R is asked for a line within each level as well: each level's line and band are drawn in its colour, and the line of every point together is drawn dashed over them, without its band, which would hide theirs.

Under the coefficient the chart prints, for a linear fit: the test that the slope is zero, with its method and the pairs used, `Linear regression: p < 0.001 (n = 200). Exploratory, unadjusted.`; the slope and the intercept with the intervals R gave, `Slope: 0.3275, 95% confidence interval 0.2721 to 0.3828.`; and R-squared. With a colour, each level's slope and intercept are in a small table. A smooth has no slope, no intercept and no test, so the chart prints its method and the pairs it used and no p-value: `Local polynomial regression (loess): the curve and its band are R’s (n = 200).` R's notes follow as R worded them, among them that the band is the confidence band of the fitted mean and not a prediction band.

With no R attached, or with stored results that hold none for the view, a linear fit and a smooth are not drawn, and the chart says why: `The linear fit is not drawn. Statistics are unavailable: no R is attached to this chart.` The points, the coefficient's own message and the identity line are not affected. Too few pairs for a line prints R's reason in the same place.

## A region, the listing and the participant profile

Dragging across the points selects a region: its participants are listed under the chart, in safety.viz's record listing, with its search, its sorting, its paging and a CSV export, and the points outside it fade. Clicking a point lists that participant and opens their profile. A click on nothing, a change to a control or a filter, or `chart.clearBrush()` lets go of the selection and empties the list.

A region is a selection for the listing. It does not change what R is asked: the coefficient and the fitted line stay those of every participant drawn in the panel, and the footnote says so when a region is selected: `14 participants in the region listed, of the 200 drawn. The statistics are still of all 200: a region lists participants and does not change what R is asked.` To restrict the statistics, use a filter.

With panels a region is in the panel it was dragged in, and lists that panel's participants. A new region, in any panel, replaces the last.

With a finger a drag on a page scrolls it, so on a device with a touch screen the chart shows a button above itself, Select a region. Until it is tapped a drag on the chart scrolls the page as it does anywhere, and a tap on a point lists its participant and opens their profile. Once it is tapped a drag on the chart selects a region and does not scroll; tap it again to scroll from the chart once more. A mouse or a pen always drags a region.

Clicking a row of the listing selects that participant. The chart then raises the event safety.viz's charts raise, `participantsSelected`, on its own root element, and the event bubbles: `event.detail.data` is a list holding the participant's id, or an empty list when the selection is cleared. safety.viz's participant profile opens on that event, in a rail beside the chart, and any other chart on the page can listen for it. A region raises no event: it lists.

The profile is the one the group comparison chart opens, with the same settings: `normal_col_high` and `normal_col_low` for results that carry a reference range, and `studyday_col` for its time axis.

## What R is asked

For each panel, one call for its coefficient:

```js
connection.run('Analyze_Correlation', {
  data, // the panel's rows: the participant's id, `x`, `y`, and `color` and `panel` when set
  args: { strXCol: 'x', strYCol: 'y', strMethod: 'pearson' },
  dataId // what the rows are: see below
});
```

and, when the fitted line is linear or a smooth, one more for its line, on the same rows and under the same `dataId`:

```js
connection.run('Analyze_Fit', {
  data,
  args: { strXCol: 'x', strYCol: 'y', strMethod: 'linear' },
  dataId
});
```

| Argument      | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `strXCol`     | Always `'x'`.                                                                           |
| `strYCol`     | Always `'y'`.                                                                           |
| `strMethod`   | For the coefficient `'pearson'` or `'spearman'`; for the line `'linear'` or `'smooth'`. |
| `strGroupCol` | `'color'`, when there is a colour; otherwise the argument is left out.                  |

Nothing else is sent. The confidence level, the minimum number of pairs and the number of points on a line are gsm.bio's defaults, and each is printed or drawn from what R returns. `identity` is never sent: it is not R's.

In `data`, `x` and `y` are the values as plotted: on a logarithmic axis, the base-10 logarithm of the value.

`dataId` states what the rows are. A [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together, so the identity is built only from what the settings and the controls say, by the settings' own names, and from the colour's levels in the rows:

| Member            | Value                                                                                                                                  | Left out when         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `chart`           | `'association-scatter'`.                                                                                                               | never                 |
| `x`               | The x variable, as the setting `x` writes it in full: `{ measure, value, visit }`, without `visit` for a baseline value, or `{ col }`. | never                 |
| `y`               | The y variable, the same way.                                                                                                          | never                 |
| `baseline_visits` | The setting, as a list.                                                                                                                | the setting is null   |
| `baseline_stat`   | The setting.                                                                                                                           | never                 |
| `color_by`        | The colour column.                                                                                                                     | there is no colour    |
| `groups`          | The distinct values of `color` in the rows, as text, sorted by code point.                                                             | there is no colour    |
| `panel_by`        | The panel column.                                                                                                                      | there are no panels   |
| `panel`           | The panel's level of that column.                                                                                                      | there are no panels   |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point.                  | no filter is in force |
| `x_scale`         | `'log'`, where `x` in the rows is a logarithm.                                                                                         | the x axis is linear  |
| `y_scale`         | `'log'`, where `y` in the rows is a logarithm.                                                                                         | the y axis is linear  |

A member that is not set is left out, never written as null. A list is a list whatever its length. Sorting by code point is what R's `sort(x, method = "radix")` does, so both sides write the same list without a locale. The method is an argument and not part of the identity; a region is part of neither.

`chart.statistics()` returns what the chart has asked for the panels now drawn, one entry per request, a panel's coefficient before its line: `{ panel, kind, name, args, dataId, rows, answer }`, where `kind` is `coefficient` or `fit`, `rows` is the number of rows handed over and `answer` is what the connection resolved to, or null while R has not answered. It is the key a stored result must carry, read from the chart itself.

### Stored results, from R

A page that ships R's answers gives the chart a connection with `results`: one stored result per panel of the views it computed for the coefficient, and one more per panel for a fitted line. A view with no stored result reads `Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.` It is never answered with another view's numbers: another variable, value type, visit, method, colour, panel, filter or scale is another key.

In R, the keys of one panel's stored results, from the panel's rows and what the view is set to:

```r
# dfRows: the panel's rows, one per participant: the id, x, y (and color, panel when set).
#         On a logarithmic axis x or y is log10() of the value.
# lView:  the view, by the chart's names; a member that is not set is NULL. x and y
#         are each a variable as the settings write one: list(measure =, value =,
#         visit =), without visit for a baseline value, or list(col =).

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
association_scatter_id <- function(dfRows, lView) {
  lDataId <- list(chart = "association-scatter", x = lapply(lView$x, chart_text), y = lapply(lView$y, chart_text))
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$color_by)) {
    lDataId$color_by <- lView$color_by
    lDataId$groups <- as.list(sort(unique(chart_text(dfRows$color)), method = "radix"))
  }
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- chart_text(lView$panel)
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  if (identical(lView$x_scale, "log")) lDataId$x_scale <- "log"
  if (identical(lView$y_scale, "log")) lDataId$y_scale <- "log"
  lDataId
}

# The coefficient.
association_scatter_key <- function(dfRows, lView) {
  lArgs <- list(strXCol = "x", strYCol = "y", strMethod = lView$method)
  if (!is.null(lView$color_by)) lArgs$strGroupCol <- "color"
  list(
    name = lView$statistic,
    args = lArgs,
    dataId = association_scatter_id(dfRows, lView),
    rows = nrow(dfRows)
  )
}

# The fitted line: lView$fit is "linear" or "smooth".
association_scatter_fit_key <- function(dfRows, lView) {
  lArgs <- list(strXCol = "x", strYCol = "y", strMethod = lView$fit)
  if (!is.null(lView$color_by)) lArgs$strGroupCol <- "color"
  list(
    name = lView$fit_statistic,
    args = lArgs,
    dataId = association_scatter_id(dfRows, lView),
    rows = nrow(dfRows)
  )
}

lKey <- association_scatter_key(dfRows, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfRows), lKey$args))))
```

`lView$x` is written with its value type in full, `value = "raw"` for a result itself. `lView$filters` is a named list of column to the values the filter lets through. Written to JSON, a single value is a single value and an unnamed list is an array (`jsonlite::toJSON(auto_unbox = TRUE)`), and the value is in [the shape the browser form gives](r-connection.md#stored-results).

These are the functions `tools/r-association-statistics.R` writes the chart's expected results with. The unit tests named `AS-STAT-013` hold the keys they write, for twenty-four panels of the gallery's demo, to the keys the chart asks with, and hand the results to a connection as stored results to see each one found.

### In the browser

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, as the connection's `browser.sourceUrl`. This repository keeps a copy at `site/vendor/gsm.bio/statistics.R`, with a record of the gsm.bio commit it was copied from. The file is sourced with base R alone, so a page that draws only this chart installs no package: `browser: { sourceUrl, packages: [] }`.

Nothing is fetched until the chart first asks for a statistic, which is the first time it draws points with the setting `statistic` naming a function. A chart with `statistic: null` and no linear fit or smooth asks for nothing.

The answers are checked against desktop R. `tools/r-association-statistics.R` sources the same vendored file in desktop R, runs it on rows the chart's own code wrote, and writes `tests/fixtures/association-statistics-r.json` with the R version that made it. The committed rows are the values the chart drew; for a logarithmic axis the script takes their `log10()` in R, as a widget in R does, because a logarithm taken in JavaScript is not the same to the last binary place in every engine. The two agree far inside the tolerance the answers are held to. The browser tests named `AS-LIVE-*` run the gallery's chart against real R in the browser and hold every number to that file within 1 part in 10^8: Pearson's and Spearman's coefficients, each colour's, and a linear fit's slope, intercept and band. Where R's own answer differs between the desktop's version and the browser's, both are recorded and the tolerance is not widened.

## Opened by another chart

The chart can be mounted in any element, another chart's among them, and pointed at a pair by its settings:

```js
const scatter = BioViz.associationScatter(element, {
  ...columns, // the column and baseline settings of the chart that opens it
  x: { measure: 'TNF-alpha', visit: 'Baseline' },
  y: { measure: 'IL-10', visit: 'Baseline' },
  method: 'spearman',
  connection, // the same connection, so R is started once for both
  back: { label: 'Back to the matrix', action: () => showTheGridAgain() }
}).init({ results, participants });
```

`back` puts a button above the chart with that label; a click on it, or Enter or Space when the keyboard is on it, calls `action` with the chart. The chart does nothing more: the caller takes it down with `destroy()` and shows itself again. `setSettings({ x, y })` moves an open chart to another pair, and `chart.view()` reads back what its controls are set to.

## On a phone

Below 900 pixels of width safety.viz's shell stacks: the controls above the chart, the participant profile below it. Below 600 pixels the controls start folded away, so the chart is on the first screen, and one tap on Controls opens them. Panels drop to one column. The tables under a result wrap their cells instead of running off the page, and the listing does the same. Select a region is above the chart.

## What is not here

No correlation coefficient, regression line, smooth, band, interval, p-value or adjustment is computed here: the chart chooses which of R's to ask for and prints and draws R's answer. What it works out is where a point sits, the logarithm of a value for a logarithmic axis, and the two ends of the line y = x.
