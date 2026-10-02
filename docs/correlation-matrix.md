# The correlation matrix

Which of these biomarkers, or which visits of one biomarker, are related? The chart draws a grid over a set of variables: below the diagonal each pair is a mark, sized and coloured by its correlation coefficient, and above it the coefficient is a number. Every cell has its own pair count. A click on a cell opens that pair in the [association scatter](association-scatter.md), in place, with a way back.

It draws; it does not estimate. Every coefficient, its interval and its pair count are computed by R: the chart hands R one table through the [connection to R](r-connection.md) and draws what comes back. It computes no coefficient itself, not for a number, not for a mark's size or colour, and not for an order. With no R attached the grid's frame is drawn with empty cells, and the chart says that statistics are unavailable.

The grid prints no p-value, by design. A grid of twelve variables is sixty-six pairs, and sixty-six unadjusted p-values side by side answer no question. To test one pair, open it: the association scatter prints that pair's coefficient with its interval and p-value.

It is the overview for the pair of charts: it opens on every biomarker the limit allows, and each cell is the way into the scatter. It is built as the other two charts are, from the same parts, and takes the same tables and the same column settings.

## At a glance

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  const chart = BioViz.correlationMatrix('#chart', {
    baseline_visits: 'Baseline',
    // R, started in the browser the first time the grid asks. Leave it out and
    // the cells stay empty and the chart says that statistics are unavailable.
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

That names neither a mode, a visit nor a biomarker, so the chart opens on every biomarker at the first visit.

## What the page loads

Two script tags, safety.viz's first. The chart is built from safety.viz's kit (`SafetyViz.kit`): its control sidebar, its filters and, for the small scatters, its Chart.js. bio.viz bundles none of it; it finds the kit on the page when a chart is made, and says so plainly if it is not there.

## `correlationMatrix(element, settings)`

Makes a chart in an element and returns it. `element` is the element, or a CSS selector for it. `settings` is laid over the [defaults](#settings) and may be left out. The controls are drawn at once; nothing else is drawn until the chart is given its tables.

A setting that is not known, or a value a setting cannot take, is refused: `correlationMatrix` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants }`, each an array of records, one object per row: the tables the [core](core.md) reads, as the other charts take them. Only the results table is required. With a participant table the chart shows a filter for each of its category columns; a filter chooses participants, and the ones filtered out are not in the frame.

## The grid's variables

| Mode           | The variables                             | Set by                                               |
| -------------- | ----------------------------------------- | ---------------------------------------------------- |
| `'biomarkers'` | Several biomarkers, each at one visit.    | `visit`, and `biomarkers` for which are in the grid. |
| `'visits'`     | One biomarker, at each of several visits. | `measure`, and `visits` for which are in the grid.   |

Every variable has the same value type, `value_type`: the result, the baseline value, or the change, fold change or percent change from baseline, as the [core defines them](core.md#value_types). A baseline value has no visit, so across biomarkers it is read with no visit, and across visits there is nothing to relate: the chart says so. For a change, a fold change or a percent change the one baseline visit holds the same value for everyone: across visits it is left out of the grid, and across biomarkers the chart asks for a later visit.

### How many it draws

The grid draws at most `limit` variables at a time, twelve by default: the first twelve of those chosen, in the control's order. The note above it says how many it is showing of how many, and how to bring others in: `12 of 36 biomarkers shown: the first 12 of those chosen, in the Biomarkers control’s order. The grid draws at most 12 at a time: untick biomarkers under Biomarkers to bring others in.` With no more chosen than the limit it reads `All 12 biomarkers chosen are shown.`

A grid's cells grow as the square of its variables: twelve are 66 pairs, twenty-four are 276 and thirty-six are 630. Measured in headless Chromium on a laptop (Apple M3 Pro), on a fixture of thirty-six biomarkers:

| Variables | Pairs | Drawing | R in the browser, once started | A cell at a desk (920 pixels) | A cell on a phone (390 pixels) |
| --------- | ----- | ------- | ------------------------------ | ----------------------------- | ------------------------------ |
| 12        | 66    | 9 ms    | 0.2 s                          | 62 pixels, numbers shown      | 19 pixels, marks only          |
| 24        | 276   | 18 ms   | 0.5 s                          | 30 pixels, marks only         | the grid scrolls in its box    |
| 36        | 630   | 44 ms   | 0.75 s                         | 19 pixels, marks only         | the grid scrolls in its box    |

Neither the drawing nor R is what a grid runs out of at these sizes: it is room. Twelve is the most whose cells still hold their numbers at a desk, it is the number of biomarkers in the synthetic study, and it is the group comparison chart's limit for its overview. A page with more room, or a reader content with marks, sets `limit` higher.

## What is drawn

A grid, with the variables along the top and down the side. The heading says what they are: `Result at Baseline, biomarker against biomarker`.

| Where              | What                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Below the diagonal | A mark for the pair. Its width and its darkness are the size of the coefficient; a filled blue disc is positive and an orange ring negative. |
| Above the diagonal | The coefficient, to two decimals.                                                                                                            |
| On the diagonal    | Nothing: a variable with itself. Its title says how many participants have a value for it, as R counted them.                                |

A mark reads without its colour: it is wider and darker the stronger the coefficient, on either side of nought, and the sign is the shape as well as the hue. The key under the grid shows the marks for −1, −0.5, 0, 0.5 and 1 and says this in words. The mark is read off R's coefficient: its width is 14% of the cell at nought and 92% at one, and its lightness runs from 86% to 32%.

A cell narrower than 34 pixels cannot hold a number. The grid then draws marks on both sides of the diagonal, and the numbers are in the list beneath. That is the grid a phone gets for twelve variables.

A cell is a button. Pointing at it, or moving to it with the arrow keys, writes what it holds under the grid: `TNF-alpha and IL-10: Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 (n = 200). Open the scatter.` The same sentence is the cell's name for a screen reader. The count, `n = 200`, is the number of participants who have both values: each cell has its own.

A cell with fewer complete pairs than the minimum is hatched and holds a dash: it says R's reason, `Not computed: 178 complete pairs. The minimum is 183. Counts: n = 178.`, and no number.

### The list of pairs

Under the grid is every pair R returned, in the order R returned them, with its count and its coefficient with the interval R gave: `IL-10 and TNF-alpha`, `200`, `0.6384 (0.5482 to 0.7139)`. A pair's name is a button that opens it. Download: CSV saves the list. It is where a narrow screen reads the numbers, and where a touch screen, which has no pointer to hover with, reads the counts.

### Small scatters

For six variables or fewer the Draw as control offers Small scatters: below the diagonal each pair is drawn as its points, one for each participant who has both values, the column's variable along the bottom and the row's up the side, each pair on its own axes. Above the diagonal are R's coefficients, as in the grid. The points are positions and nothing else, and the view asks R for nothing more than the grid does. `SCATTER_LIMIT` is 6.

## The frame

The grid's variables are resolved by the [core's frame](core.md#frametables-variables-settings), one variable per column, with none of them required: a participant who has some of the values is kept, with a gap where they have none. A coefficient is computed on the participants who have both of its pair's values, and which they are is counted by R, pair by pair. A participant with none of the grid's values is left out of the frame, and counted.

The note above the grid says how many participants are in the frame of how many, and the line under it says what that means: `200 participants are in the frame. A cell is of the ones who have both of its values, so each cell has its own count, and the cells are not adjusted for one another.`

## The chart's methods

The lifecycle is safety.viz's, so a page drives the libraries the same way. `init`, `setData`, `setSettings` and `close` return the chart, so calls can be chained.

| Method                        | What it does                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`            | Loads the tables and draws. The same as `setData`.                                                                                                          |
| `chart.setData(data)`         | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table.          |
| `chart.setSettings(settings)` | Lays settings over the current ones and draws again. A setting that says what the chart opens on moves its control.                                         |
| `chart.render()`              | Draws everything again from the tables, the settings and the controls, and asks R again.                                                                    |
| `chart.resize()`              | Fits the grid to its container, for a page that changes the container's size without resizing the window.                                                   |
| `chart.destroy()`             | Takes the chart down, with a scatter a cell had opened, and empties its element. A destroyed chart cannot be used again.                                    |
| `chart.statistics()`          | What the chart has asked R for the grid now drawn, and what R answered: see [what R is asked](#what-r-is-asked). It draws nothing.                          |
| `chart.open(x, y)`            | Opens the association scatter for a pair, as a click on its cell does. `x` and `y` are two of the grid's variables, each by its label. Returns the scatter. |
| `chart.close()`               | Closes that scatter and shows the grid again, as it was.                                                                                                    |
| `chart.scatter()`             | The association scatter a cell has opened, or null while the grid is shown.                                                                                 |

Tables the chart cannot read are refused: `setData` throws a `TypeError`, and the message is shown in the chart's element.

## Settings

Every setting, with its default. The column settings and the baseline settings are the [core's](core.md#default_settings), under the same names, and a setting another chart also has is named as it is there.

| Setting              | Default                       | Meaning                                                                                                                                                          |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`                   | The participant's id, in the results table.                                                                                                                      |
| `measure_col`        | `'TEST'`                      | The biomarker's name.                                                                                                                                            |
| `value_col`          | `'STRESN'`                    | The result.                                                                                                                                                      |
| `visit_col`          | `'VISIT'`                     | The visit's name.                                                                                                                                                |
| `visit_order_col`    | `'VISITNUM'`                  | A number that orders the visits. May be null.                                                                                                                    |
| `unit_col`           | `'STRESU'`                    | The unit of the result, printed in the grid's heading when every variable has the same one. May be null.                                                         |
| `participant_id_col` | `null`                        | The participant's id in the participant table, when it is not named as `id_col` is.                                                                              |
| `baseline_visits`    | `null`                        | The baseline visit, or a list of them. Null means the first visit in visit order.                                                                                |
| `baseline_stat`      | `'mean'`                      | How several baseline visits are brought to one value: `mean`, `min`, `max` or `first`.                                                                           |
| `mode`               | `'biomarkers'`                | What the grid's variables are: `biomarkers`, several at one visit, or `visits`, one biomarker at several.                                                        |
| `visit`              | `null`                        | Across biomarkers, the visit they are read at. Null means the first visit, as does a visit the table lacks.                                                      |
| `biomarkers`         | `null`                        | Across biomarkers, the ones the grid opens on. Null means every biomarker the Biomarkers control offers.                                                         |
| `measure`            | `null`                        | Across visits, the biomarker. Null means the first the control offers.                                                                                           |
| `visits`             | `null`                        | Across visits, the visits the grid opens on. Null means every visit.                                                                                             |
| `value_type`         | `'raw'`                       | The value type of every variable: `raw`, `baseline`, `change`, `fold_change` or `percent_change`.                                                                |
| `view`               | `'grid'`                      | How the pairs are drawn: `grid`, or `scatters`, the [small scatters](#small-scatters), drawn for six variables or fewer.                                         |
| `limit`              | `12`                          | The most variables drawn at a time, a whole number of two or more. See [how many it draws](#how-many-it-draws).                                                  |
| `measures`           | `null`                        | The biomarkers the controls offer, in this order. Null means every biomarker in the table, by name.                                                              |
| `max_levels`         | `12`                          | The most different values a column may hold and still be offered as a filter.                                                                                    |
| `filters`            | `null`                        | The filters, as names or `{ value_col, label }`, with safety.viz's `start`, `all` and `multiple`. Null means every category column of the participant table.     |
| `connection`         | `null`                        | The connection to R the grid asks. Null means one with no R attached.                                                                                            |
| `statistic`          | `'Analyze_CorrelationMatrix'` | The R function the grid asks for: gsm.bio's, or one that takes the same arguments. Null means no coefficients and no Statistics controls.                        |
| `method`             | `'pearson'`                   | The coefficient the chart opens on: `pearson` or `spearman`.                                                                                                     |
| `min_pairs`          | `null`                        | The fewest complete pairs a cell needs to show a coefficient, a number above nought. Null leaves the minimum to R: nothing is sent, and R's own default applies. |
| `waiting_note`       | `null`                        | A sentence added to the waiting text until R has answered once: what starting R costs on this page. Null means none.                                             |
| `scatter`            | `null`                        | Settings for the association scatter a cell opens, laid under what the grid carries across: see [a cell opens the scatter](#a-cell-opens-the-scatter).           |

There is no setting that chooses a confidence level or an adjustment: those are R's. The minimum number of pairs is R's as well: the chart has a control for it because the design asks for one, and what the control holds is handed to R, which applies it. The chart never withholds a cell itself.

## The controls

In safety.viz's sidebar.

| Section    | Control                  | What it sets                                                                                               |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Variables  | Relate                   | Biomarkers at one visit, or the visits of one biomarker.                                                   |
| Variables  | Value                    | The value type of every variable.                                                                          |
| Variables  | Visit, Biomarkers        | Across biomarkers: the visit, and which biomarkers are in the grid. No Visit control for a baseline value. |
| Variables  | Biomarker, Visits        | Across visits: the biomarker, and which visits are in the grid.                                            |
| Display    | Draw as                  | Grid, or Small scatters, which is offered for six variables or fewer.                                      |
| Statistics | Method                   | Pearson or Spearman.                                                                                       |
| Statistics | Minimum pairs for a cell | The fewest complete pairs a cell needs. Empty, which is how it opens, leaves the minimum to R.             |
| Filters    | one per filter           | The participants in the frame. Only with a participant table.                                              |
|            | Reset chart              | Returns every control to what the chart opened on.                                                         |

## The statistics

The function is gsm.bio's `Analyze_CorrelationMatrix`, which runs R's own `cor.test` on each pair's complete rows. The grid asks once, whatever the number of cells.

Under the grid the chart prints the method as R names it and how many pairs it returned, `Pearson's product-moment correlation, pair by pair: 66 pairs of 12 variables, each on the participants who have both of its values.`; then what R said about its answer, as R worded it; then what the grid covers. R's notes say that a matrix reports no p-values and, for Spearman, that `cor.test` gives no interval, so none is reported: none is made up.

A coefficient is printed through the shared formatter, [`formatPair`](r-connection.md#formatpairrow): to four significant figures in the sentence under the grid and in the list, with the interval R gave, and to two decimals in a cell. The coefficient is called `Pearson’s r` or `Spearman’s rho`, by the method that was asked for.

Where no pair has enough complete pairs R answers with its reason, `Not computed: no pair of columns has 5 complete pairs.`, and the chart prints it in place of the line: every cell is hatched, and none holds a number.

### Waiting, and never a stale answer

The two rules every chart keeps. From the moment the grid is asked for until R answers, the line reads `Statistics: waiting for R…`, with the setting `waiting_note` until R has answered once, and the cells are empty. Every time the chart is drawn the cells, the list and the line are cleared and asked for again, and an answer that was asked for before the chart was last drawn is dropped when it arrives. A change to the mode, the value, a visit, the biomarkers, the method, the minimum or a filter draws the chart again. A cell never shows a coefficient for a frame other than the one on screen.

## A cell opens the scatter

A click on a cell, Enter or Space on it, or a click on a pair in the list, opens the [association scatter](association-scatter.md) for that pair in place of the grid: the column's variable on its x axis and the row's on its y axis. The scatter is the chart of that name, whole, with its own controls. The grid hands it:

| Carried across | How                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The pair       | The scatter's `x` and `y`.                                                                                                         |
| The method     | Its `method`: Pearson in the grid is Pearson in the scatter.                                                                       |
| The filters    | Its `filters`, each opening on what the grid's is set to.                                                                          |
| The connection | Its `connection`: the same one, so R is started once for both and stored results serve both.                                       |
| The columns    | The column and baseline settings, `measures` and `max_levels`.                                                                     |
| The way back   | Its `back`: a button above the scatter, `Back to the correlation matrix`, which takes the keyboard's place when the scatter opens. |

Anything else the scatter should have, its `groups`, its `numbers`, a `color_by`, a `fit`, its participant profile's settings, is given in the setting `scatter` and laid under those.

The scatter asks R for its own statistics, as it always does: that pair's coefficient with its interval and its p-value, and a fitted line if one is chosen. On the same rows it is the coefficient the cell holds.

Back to the correlation matrix, by a click or by Enter or Space, takes the scatter down and shows the grid again exactly as it was: the same cells, the same list, the keyboard's place on the cell that was opened. Nothing is drawn again and R is not asked again, because nothing the grid holds has changed. What was changed in the scatter, its filters among them, stays in the scatter and is gone with it.

`chart.open(x, y)` does the same from code, and `chart.close()` the way back. Drawing the grid again, by `render`, `setSettings` or `setData`, closes a scatter that is open.

## What R is asked

For the grid, one call:

```js
connection.run('Analyze_CorrelationMatrix', {
  data, // the frame: the participant's id, and `v1`, `v2`, … one per variable of the grid
  args: { chrCols: ['v1', 'v2', 'v3'], strMethod: 'pearson' },
  dataId // what the frame is: see below
});
```

| Argument    | Value                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `chrCols`   | The names of the frame's columns, in the grid's order: `v1` for its first variable, `v2` for its second. |
| `strMethod` | `'pearson'` or `'spearman'`.                                                                             |
| `nMinPairs` | The number in the Minimum pairs control, when the reader set one; otherwise the argument is left out.    |

Nothing else is sent: the confidence level is gsm.bio's default. In `data` a value a participant does not have is null, which R reads as missing.

R's `rows` name each pair by those column names, `x: 'v9', y: 'v11'`, and the chart finds the pair's two variables by them.

`dataId` states what the frame is. A [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together:

| Member            | Value                                                                                                                                                        | Left out when         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `chart`           | `'correlation-matrix'`.                                                                                                                                      | never                 |
| `variables`       | The grid's variables in order, each written as the association scatter writes a variable: `{ measure, value, visit }`, without `visit` for a baseline value. | never                 |
| `baseline_visits` | The setting, as a list.                                                                                                                                      | the setting is null   |
| `baseline_stat`   | The setting.                                                                                                                                                 | never                 |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point.                                        | no filter is in force |

A member that is not set is left out, never written as null. The mode is not a member: the variables say it. The method and the minimum are arguments.

`chart.statistics()` returns what the chart has asked for the grid now drawn: one entry, `{ name, args, dataId, rows, answer }`, where `rows` is the number of rows in the frame and `answer` is what the connection resolved to, or null while R has not answered. It is the key a stored result must carry, read from the chart itself.

### Stored results, from R

A page that ships R's answers gives the chart a connection with `results`: one stored result for each grid it computed, and, for a pair a cell opens, the association scatter's own [stored results](association-scatter.md#stored-results-from-r) for that pair, since the scatter asks through the same connection. A view with no stored result reads `Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.`, and its cells stay empty: it is never answered with another view's numbers.

In R, the key of one grid's stored result, from the frame and what the view is set to:

```r
# dfFrame: the frame, one row per participant: the id, and one numeric column per
#          variable of the grid, named v1, v2, … in the grid's order, NA where the
#          participant has no value.
# lView:   the view, by the chart's names; a member that is not set is NULL.
#          variables is an unnamed list, one per column of the grid in order, each a
#          variable as the settings write one: list(measure =, value =, visit =),
#          without visit for a baseline value.
correlation_matrix_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "correlation-matrix", variables = unname(lView$variables))
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(lView$baseline_visits)
  lDataId$baseline_stat <- lView$baseline_stat
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(as.character(xValues)), method = "radix"))
    })
  }
  lArgs <- list(
    chrCols = as.list(paste0("v", seq_along(lView$variables))),
    strMethod = lView$method
  )
  if (!is.null(lView$min_pairs)) lArgs$nMinPairs <- lView$min_pairs
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfFrame))
}

lKey <- correlation_matrix_key(dfFrame, lView)
lStored <- c(lKey, list(value = do.call(lKey$name, c(list(dfFrame), lKey$args))))
```

The frame holds the participants who have at least one of the grid's values, after the filters; `rows` is how many they are. Written to JSON, a single value is a single value and an unnamed list is an array (`jsonlite::toJSON(auto_unbox = TRUE)`), and the value is in [the shape the browser form gives](r-connection.md#stored-results).

This is the function `tools/r-matrix-statistics.R` writes the chart's expected results with. The unit tests named `CM-STAT-009` hold the key it writes, for ten views of the gallery's demo, to the key the chart asks with, and hand its results to a connection as stored results to see each one found.

### In the browser

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, as the connection's `browser.sourceUrl`; the file is sourced with base R alone, so a page that draws only this chart installs no package. Nothing is fetched until the grid first asks, which is the first time it is drawn with the setting `statistic` naming a function.

The answers are checked against desktop R. `tools/r-matrix-statistics.R` sources the same vendored file in desktop R, runs it on frames the chart's own code wrote, and writes `tests/fixtures/matrix-statistics-r.json` with the R version that made it. The browser tests named `CM-LIVE-*` run the gallery's chart against real R in the browser and hold every cell's coefficient, interval and pair count to that file within 1 part in 10^8, across biomarkers and across visits. Where R's own answer differs between the desktop's version and the browser's, both are recorded and the tolerance is not widened.

## On a phone

Below 900 pixels of width safety.viz's shell stacks, and below 600 the controls start folded away, one tap from open. The grid is as wide as the page allows and no wider: the page never scrolls sideways.

Twelve variables on a phone are cells of about 19 pixels: too small for a number, so both sides of the diagonal are marks and the grid is read as a picture. The numbers, the intervals and the counts are in the list beneath, in the order R returned them, and each pair in it is a button as well as its cell, which is the easier target for a finger. With six variables or fewer the cells are wide enough for their numbers, and for the small scatters.

More variables than fit at 18 pixels a cell, which the default limit never reaches, scroll sideways inside the grid's own box.

## What is not here

No correlation coefficient, interval or p-value is computed here, and no p-value is printed. The chart works out which cell a pair is in, how wide and what colour a mark is for the coefficient R returned, and where a participant's point sits in a small scatter.
