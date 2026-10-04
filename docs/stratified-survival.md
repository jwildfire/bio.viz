# The stratified survival chart

Do participants with high and low levels of this biomarker have different outcomes? The chart draws a Kaplan–Meier curve for each group, with a mark at each censored time and the number at risk beneath, above a small histogram of the biomarker that shows where the cut falls and how many participants land on each side. The groups are a column's, or a biomarker or a participant-level number cut by the core's shared [cut rule](core.md#the-cut-rule). A cut's line on the histogram can be dragged: the curves follow it at once, and when it is let go the cut becomes a typed point and R is asked again. Under the curves, R's log-rank test of the groups is printed with each group's median survival and its interval and, for two groups, the hazard ratio with its interval. A click on a curve, or on a count of the at-risk strip, lists its participants, and a row of the listing opens safety.viz's participant profile.

```js
BioViz.stratifiedSurvival('#chart', {
  endpoint: 'EFS',
  group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
  connection: BioViz.r.createConnection({
    browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: ['survival'] }
  })
}).init({ results, participants, outcomes });
```

Experimental: the curves are safety.viz's estimator, `kmEstimate`, which awaits its clinical review.

## What the page loads

safety.viz's script-tag bundle first, then bio.viz's: the chart is built from safety.viz's kit, which it finds on the page as `SafetyViz.kit` when it is made. Its curves are the kit's `kmEstimate`, and they and the histogram are drawn with the kit's Chart.js. Without safety.viz on the page the chart is refused with a message saying what is missing. R in the browser needs the survival package, which gsm.bio's `Analyze_Survival` calls: give it in the connection's `browser.packages`.

## `stratifiedSurvival(element, settings)`

Makes the chart in `element`, a DOM element or a CSS selector for one, with `settings` laid over the defaults below. The controls are drawn at once; the tables are given to `init`. A setting that is not known, or a value a setting cannot take, is refused: `stratifiedSurvival` throws a `TypeError` whose message begins `bio.viz:` and names the setting.

## The tables

`init` and `setData` take `{ results, participants, outcomes }`, each an array of records, one object per row. `results` and `participants` are the tables the [core](core.md) reads, and the column settings are the core's. The groups come from them: a column of the participant table, or of the results rows, or a biomarker cut at a visit.

`outcomes` is one row per participant and endpoint, with the time and a flag, as ADaM's time-to-event datasets hold them: by default `PARAMCD` names the endpoint, `PARAM` says it in words, `AVAL` is the time, and `CNSR` is ADaM's censor flag, 1 for censored and 0 for an event. The flag may be read the other way round, as an event flag, 1 for an event: name it with `event_col`, as gsm.bio's `Analyze_Survival` takes `strCensorCol` or `strEventCol`. Exactly one is named. An outcomes table without a column the settings name is refused, with a message that names the column. Without an outcomes table the chart draws nothing and says that it needs one, with its controls.

A participant with a group and no row for the endpoint is left out and counted (`No outcome for the endpoint`), and so is one with more than one row for it, one whose time or flag is missing or not a number, one whose flag is not 0 or 1, and one whose time is below 0. A flag may also be logical, `true` or `false`, or written `TRUE` or `FALSE`, as R's `Analyze_Survival` takes one. A row of the outcomes table for a participant neither the participant table nor the results have is not used, and counted (`Outcome row for no such participant`). A participant with no group is left out and counted as the core counts it. When the filters together let nobody through, the chart draws nothing, asks R for nothing and reads `No participant passes the filters.`, the words every chart uses. If drawing fails for any other reason, the footnote says `This chart could not be drawn:` and why, nothing half drawn is left, and the controls stay.

## The chart's methods

| Method                          | What it does                                                                                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.init(data)`              | Loads the tables and draws. The same as `setData`.                                                                                                                                                                                                                                                  |
| `chart.setData(data, settings)` | Replaces the tables and draws again. The controls are rebuilt and return to what the settings open on. A bare array is taken as the results table. `settings`, when given, are laid over the chart's with the tables, for tables that need them, and the tables are checked against those settings. |
| `chart.setSettings(settings)`   | Lays new settings over the current ones and draws again. A setting that says what the chart opens on (`endpoint`, `group_by`, `filters`) moves its control.                                                                                                                                         |
| `chart.render()`                | Draws again from the tables, the settings and the controls, and asks R again.                                                                                                                                                                                                                       |
| `chart.moveCut(index, value)`   | Moves a cut line, as dragging it does: the curves, the at-risk strip and the histogram follow at once, and R is not asked. Returns the cut points drawn, or null when the line cannot go there.                                                                                                     |
| `chart.dropCut(index, value)`   | Lets a cut line go at `value`, as dropping it does: the cut becomes typed points, the moved one as its label writes it, and R is asked. Returns the typed points, or null when the line cannot go there.                                                                                            |
| `chart.listGroup(level)`        | Lists the participants of one group, as a click on its curve does, and returns them.                                                                                                                                                                                                                |
| `chart.listAtRisk(level, time)` | Lists the participants of a group at risk at a time, as a click on that count of the at-risk strip does, and returns them.                                                                                                                                                                          |
| `chart.statistics()`            | What the chart has asked R for the view now drawn and what R answered: `[{ name, args, dataId, rows, answer }]`, or none when nothing is asked.                                                                                                                                                     |
| `chart.resize()`                | Fits the curves and the histogram to their containers.                                                                                                                                                                                                                                              |
| `chart.destroy()`               | Takes the chart down. A destroyed chart cannot be used again.                                                                                                                                                                                                                                       |

## Settings

| Setting              | Default              | What it is                                                                                                                                                    |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_col`             | `'USUBJID'`          | The participant's id, in the results table.                                                                                                                   |
| `measure_col`        | `'TEST'`             | The biomarker's name.                                                                                                                                         |
| `value_col`          | `'STRESN'`           | The result.                                                                                                                                                   |
| `visit_col`          | `'VISIT'`            | The visit.                                                                                                                                                    |
| `visit_order_col`    | `'VISITNUM'`         | A number that orders the visits. May be null.                                                                                                                 |
| `unit_col`           | `'STRESU'`           | The unit. May be null.                                                                                                                                        |
| `participant_id_col` | `null`               | The participant's id in the participant table. Null means `id_col`'s name.                                                                                    |
| `baseline_visits`    | `null`               | The baseline visit, or a list of them, for a cut variable that is a change from baseline. Null means the first visit.                                         |
| `baseline_stat`      | `'mean'`             | How several baseline results are brought to one: `mean`, `min`, `max` or `first`.                                                                             |
| `outcome_id_col`     | `null`               | The participant's id in the outcomes table. Null means `id_col`'s name.                                                                                       |
| `endpoint_col`       | `'PARAMCD'`          | The endpoint, in the outcomes table.                                                                                                                          |
| `endpoint_label_col` | `'PARAM'`            | The endpoint in words, for the Endpoint control and the time axis. May be null.                                                                               |
| `time_col`           | `'AVAL'`             | The time to the event or to censoring.                                                                                                                        |
| `censor_col`         | `'CNSR'`             | The censor flag: 1 for censored, 0 for an event. Null when `event_col` is named; naming `event_col` alone sets it to null.                                    |
| `event_col`          | `null`               | The event flag, 1 for an event, 0 for censored, in place of `censor_col`.                                                                                     |
| `endpoint`           | `null`               | The endpoint the chart opens on. Null means the first.                                                                                                        |
| `group_by`           | `null`               | The groups: a column's name, or a cut variable (`{ measure, visit, cut }` or `{ col, type: 'number', cut }`). Null means the first column offered.            |
| `cuts`               | `null`               | Cut variables the Groups control offers beside the columns, as a list.                                                                                        |
| `at_risk_times`      | `null`               | The times the at-risk strip counts at, ascending. Null means the time axis's ticks.                                                                           |
| `measures`           | `null`               | The biomarkers the participant profile shows, in order. Null means every biomarker.                                                                           |
| `groups`             | `null`               | The columns the Groups control offers, as `{ value_col, label }`. Null means every category column.                                                           |
| `max_levels`         | `12`                 | The most different values a column may hold and still be a category.                                                                                          |
| `filters`            | `null`               | The filters, as `{ value_col, label, start, all }`. Null means every category column of the participant table.                                                |
| `details`            | `null`               | The listing's columns. Null means the participant, the group, the time and the outcome.                                                                       |
| `page_size`          | `10`                 | The listing's rows on a page.                                                                                                                                 |
| `connection`         | `null`               | The connection to R ([`BioViz.r.createConnection`](r-connection.md)). Null means none: the line says statistics are unavailable.                              |
| `statistic`          | `'Analyze_Survival'` | The R function the test is asked of. Null for no statistics line.                                                                                             |
| `waiting_note`       | `null`               | A sentence the line adds while it waits, until R has answered once on the connection: what starting R costs on the page.                                      |
| `back`               | `null`               | A way back, when another chart opened this one in its place: `{ label, action }`.                                                                             |
| `profile`            | `true`               | Whether a row of the listing opens safety.viz's participant profile.                                                                                          |
| `profile_details`    | `null`               | The columns the profile's header shows. Null means the category columns.                                                                                      |
| `studyday_col`       | `null`               | The study day, for the profile. May be null.                                                                                                                  |
| `normal_col_high`    | `null`               | The upper limit of normal, for the profile. May be null.                                                                                                      |
| `normal_col_low`     | `null`               | The lower limit of normal, for the profile. May be null.                                                                                                      |
| `title`              | `null`               | The title above the chart: text with placeholders such as `{n}`, filled from the view drawn ([titles and footnotes](#titles-and-footnotes)). Null means none. |
| `subtitle`           | `null`               | The line under the title, written the same way. Null means none.                                                                                              |
| `footnotes`          | `null`               | Footnotes under the chart: text, or a list of texts, with placeholders. The chart's own footnote is always last. Null means none but that one.                |
| `downloads`          | `true`               | Whether the downloads are offered under the chart: the PNG, the statistics and the table ([downloads](#downloads)).                                           |
| `png_scale`          | `2`                  | The PNG's resolution: image pixels per CSS pixel, from 1 to 4. At 2 the picture is twice the size it is drawn on the page, 192 pixels to the inch.            |

## Titles and footnotes

The settings `title`, `subtitle` and `footnotes` are text with named placeholders, filled from the view drawn each time the chart draws. A placeholder is a name in braces, and it is replaced by text: nothing in a setting or a value is evaluated, and a name the chart does not have is left as written. The title and the subtitle are drawn above the chart, and the footnotes under it; the chart's own footnote, always last, says when and by what it was drawn and what stands behind each statistic printed. The rules are in [Getting results out](output.md).

| Placeholder  | What it holds                                       |
| ------------ | --------------------------------------------------- |
| `{endpoint}` | The endpoint, by its label.                         |
| `{group}`    | What the groups are, as the Group control names it. |
| `{n}`        | How many participants are drawn.                    |
| `{filters}`  | The filters in force, in words, or `none`.          |
| `{date}`     | The date drawn, in UTC: `2026-10-04`.               |
| `{version}`  | The bio.viz version.                                |

## Downloads

Under the footnotes a bar offers three downloads, each saved as a file named for the chart and the view, such as `bio.viz-stratified-survival-….png`:

| Download         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG              | The chart's frame as a picture: the title and subtitle, the notes, what the chart draws, the statistics line and the footnotes, the chart's own last, at `png_scale` image pixels per CSS pixel. The file carries its title, its footnotes and its resolution in its own text and size chunks. What a reader works the chart with (the controls, the hint, the listing, the bar) is left out, and what scrolls sideways is drawn whole. |
| Statistics (CSV) | The statistics R returned for the view, as shown: a row for each answer's result and one for each of its parts, every member R returned a column and every number as R returned it. Offered once R has answered.                                                                                                                                                                                                                        |
| Table (CSV)      | The table the chart drew from: one row per participant drawn: the participant, their group, the biomarker's value when the groups are a cut, their time and whether it ended in the event.                                                                                                                                                                                                                                              |

A CSV file is written by RFC 4180: a field, or a heading, that holds a comma, a double quote or a line break is quoted. `chart.fileOf(kind)` gives the same file without saving it: a promise of `{ name, blob }`, for `kind` `'png'`, `'statistics'` or `'table'`. The format of each file is in [Getting results out](output.md#downloads).

## What is drawn

- The curves: each group's Kaplan–Meier estimate, the kit's `kmEstimate`, drawn as steps from 1 at time 0 to the group's last time, with a short upright mark at each censored time. A cut's groups run low to high, labelled with their bounds; a column's are in order of name. The legend gives each group's number of participants, and hides nothing when clicked. No confidence band is drawn, and none is worked out here: the chart reads only the estimate's steps and censored times, never the bounds `kmEstimate` also returns. A click lists a group only when it is on that group's curve, within a few pixels.
- The at-risk strip: for each group, the number at risk at each time of the axis, the participants whose time is at or after it. A group's name lists its participants, and a count lists the participants it counts.
- The histogram, for a cut variable: the values the cut points were worked out on, in equal bars, with a dashed line at each cut point and how many values fall in each group. Each line can be dragged with a pointer, and each is a slider of its own for the keyboard (see [moving a cut line](#moving-a-cut-line)).
- A cut's points are worked out on the participants the filters keep who have a value of the cut variable and an outcome for the endpoint: the ones the curves are drawn of, so the median cuts them in halves, as R's `Analyze_Screen` cuts a biomarker for its hazard ratio. The footnote says so.
- The footnote: how to list a group, and how the variable was cut.

## Moving a cut line

A line is taken hold of within a few pixels of it, more with a finger, and moves by as much as the pointer moves from where it took hold: a click on or beside a line, with no drag, leaves it where it is and asks R nothing. From the keyboard, each line is a slider (`role="slider"`, with its value and how far it can go): the left and right arrows move it by one bar of the histogram, Page Up and Page Down by five, Home and End as far as it can go; the curves follow each key, and R is asked once the keys have rested. While a line is held the curves, the at-risk strip and the histogram follow it at once, drawn for the cut where the line is, and the statistics line says that R is asked when the line is let go: no answer for another cut stays on screen. When it is let go the line lands on the point its label writes, four significant digits, so the point in the settings, in the key R's stored result is found by and on the label are one number. The cut becomes typed points (the median `2.783`, moved to `4`, is `cut: [4]`), the Groups control holds it, and R is asked for the new groups. A line cannot pass its neighbour, nor stop where two points would be written alike, nor leave the values it cuts: it stays between the least and the greatest. Reset returns to the cut the settings name.

## The statistics line

R is asked once per view, with one row per participant drawn: the id, `time`, `group`, and the flag, `censor` or `event`, as the outcomes table gives it. The line says it is waiting until R answers, and a change to a control, a filter or the cut clears it and asks again; an answer to a question no longer on screen is never shown. R's log-rank result is printed with its method and counts, labelled exploratory and unadjusted. Under it, each group's median survival with its log-log interval, as R's `survfit()` gives it, a median or a bound the curve did not reach reading `not reached`; and, for two groups, the hazard ratio with its interval, Cox's: for a cut, the hazard in the higher group over the hazard in the lower. Where R does not estimate the hazard ratio, as when one group has no event, it is not printed, and R's note says why. What R said about its answer is printed as R worded it. The chart computes no test statistic, no p-value, no median and no hazard ratio. With no R attached the curves are still drawn, and the line says that statistics are unavailable.

### What R is asked

```js
connection.run('Analyze_Survival', {
  data, // one row per participant drawn: the id, time, group, censor (or event)
  args: {
    strTimeCol: 'time',
    strGroupCol: 'group',
    strCensorCol: 'censor', // or strEventCol: 'event'
    chrGroups: ['> 2.783', '≤ 2.783'] // a cut's high to low, a column's by code point
  },
  dataId // what the rows are: see below
});
```

The groups R is handed are in an order that depends on nothing but them: a cut's high to low, a column's sorted by code point, as R's `sort(method = "radix")` sorts them, the same in every browser and every language. The hazard ratio is the first group's hazard over the second's, so for a cut it is the higher group's over the lower's, as the biomarker screen's "High / Low" is; The line lists the medians in the legend's order, and names a cut's hazard ratio `Hazard ratio, high over low`.

`dataId` states what the rows are, so a [stored result](r-connection.md#stored-results) is found by the function's name, these arguments and this identity together:

| Member            | What it is                                                                                                            | Left out when                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `chart`           | `'stratified-survival'`.                                                                                              | never                                                       |
| `endpoint`        | The endpoint.                                                                                                         | never                                                       |
| `group_by`        | The groups: the column's name, or the cut variable as the settings write it, typed points as a list.                  | never                                                       |
| `baseline_visits` | The setting, as a list.                                                                                               | the setting is null, or the cut biomarker reads no baseline |
| `baseline_stat`   | The setting.                                                                                                          | the cut biomarker reads no baseline                         |
| `filters`         | An object: each filter in force, by its column, as the list of values it lets through, as text, sorted by code point. | no filter is in force                                       |

A cut biomarker reads a baseline when its value is the baseline or a change from it (`value` other than `raw`). The R recipe that writes the same key is `survival_key` in `tools/r-survival.R`, which writes the expected results the tests hold this chart to: each group's curve as `survfit()` gives it, and what `Analyze_Survival` answers.

## On a phone

At 390 pixels the controls start folded away, the at-risk strip scrolls inside its own box when it is wider than the screen, and the page does not scroll sideways.

## What is not here

No test statistic, p-value, median, hazard ratio, confidence band or adjustment is computed here: the chart draws the kit's product-limit estimate and counts who is at risk, which describe the participants, and every test and estimate printed is R's.
