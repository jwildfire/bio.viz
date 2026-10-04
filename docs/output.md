# Getting results out

What every chart does so that what it shows can leave the browser and still say what it is: a title, a subtitle and footnotes written with placeholders the chart fills from the view it draws, and one footnote the chart always writes last, saying when and by what the figure was drawn and what stands behind each statistic it printed. The rules are written once, in `src/shared/titles.js`, and every chart follows them; a page or a widget that writes the same words reaches them as `BioViz.output`.

Under the footnotes each chart offers three downloads: a PNG of the chart with its title and footnotes drawn in, the statistics R returned as CSV, and the table the chart drew from as CSV. The specification a chart is written to and rebuilt from comes next, under the same requirement ([obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361)).

## At a glance

```js
BioViz.groupComparison('#chart', {
  start_value: 'IL-6',
  visits: ['Week 4'],
  value_type: 'change',
  group_by: 'ARM',
  title: '{measure}: {value} at {visits}',
  subtitle: '{n} participants, by {group}',
  footnotes: ['Synthetic study from gsm.bio.', 'Filters: {filters}.']
}).init({ results, participants });
```

Above the chart:

> IL-6: Change from baseline at Week 4
> 186 participants, by Arm

Under it, the two footnotes and the chart's own:

> Synthetic study from gsm.bio.
> Filters: none.
> Drawn on 2026-10-04 by bio.viz 0.1.0. Statistics: Welch Two Sample t-test (Placebo n = 95, Treatment n = 91); computed by R in this browser.

## The settings

Every chart has the three settings, with the same defaults and the same checks.

| Setting     | Default | What it is                                                                                                                            |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `title`     | `null`  | The title above the chart: text with placeholders. Null means none.                                                                   |
| `subtitle`  | `null`  | The line under the title, written the same way. Null means none.                                                                      |
| `footnotes` | `null`  | Footnotes under the chart: text, or a list of texts, with placeholders, in the order given. Empty texts are dropped. Null means none. |

A title or a subtitle that is not text, or footnotes that are not text or a list of texts, are refused with a sentence that names the setting, as every other setting is. The chart's own footnote is not a setting: it is always written, and always last.

## Placeholders

A placeholder is a name in braces: `{measure}`. When the chart draws, each one is replaced by the text of its value for the view drawn, and the title, the subtitle and the footnotes are written again whenever the chart draws again or an answer from R arrives.

- A placeholder is replaced by text, once, from left to right. Nothing in a template or in a value is evaluated: there are no expressions, no functions and no templates that run, and a value is never read for placeholders of its own. `${…}`, `<script>` and `{{…}}` are shown as they are written.
- A name the chart does not have is left as written, braces and all, so a slip in a setting shows on the page instead of disappearing.
- A value that is null is written as nothing; a number as it reads.
- What comes out is written on the page as text, never as markup.

Every chart fills these three:

| Placeholder | What it holds                                                           |
| ----------- | ----------------------------------------------------------------------- |
| `{filters}` | The filters in force, in words (`Sex is F; Arm is Placebo`), or `none`. |
| `{date}`    | The date drawn, in UTC, as ISO 8601: `2026-10-04`.                      |
| `{version}` | The bio.viz version.                                                    |

Each chart adds its own, listed in its reference under Titles and footnotes: [group comparison](group-comparison.md#titles-and-footnotes), [association scatter](association-scatter.md#titles-and-footnotes), [correlation matrix](correlation-matrix.md#titles-and-footnotes), [biomarker screen](biomarker-screen.md#titles-and-footnotes), [cross-tabulation](cross-tab.md#titles-and-footnotes) and [stratified survival](stratified-survival.md#titles-and-footnotes). Every chart has `{n}`, the participants it draws.

## Where they are drawn

The title and the subtitle are drawn at the top of the chart's own frame, above its toolbar, notes and figure; the footnotes at the bottom of it, under the figure and the statistics line and above the listing. They are part of the chart's element, so they move, wrap and print with it, and at a 390-pixel viewport they wrap like any other text, with no horizontal scroll. The title is a heading of level 2 to assistive technology.

## The footnote the chart writes

The last footnote is the chart's, and it says three things:

1. The date the chart was drawn, in UTC, and the bio.viz version that drew it: `Drawn on 2026-10-04 by bio.viz 0.1.0.`
2. For every statistic printed, R's method and the counts R used, as R returned them: `Welch Two Sample t-test (Placebo n = 95, Treatment n = 91)`. One count is written `n = 200`; up to four groups each by name; more, such as a screen's biomarkers, as the least and the most with how many there are: `n = 179 to 186 across 12 biomarkers`.
3. Which R computed them: `computed by R in this browser`, or, for a result stored with the page, `computed by R 4.3.3 with gsm.bio 0.2.0, stored with the page` when the connection was told the versions (`computedBy`, below), and `stored with the page` when it was not.

While an answer is on its way it says `Statistics: waiting for R.`, and it is written again when the answer arrives. A chart that asked R nothing says `No statistic was asked of R.`; one whose answer did not come says that statistics are unavailable, or that R reported an error, as the statistics line under the chart says in full.

Nothing in the footnote is worked out by the chart. The method and the counts are R's, read off its answer; the chart only writes them down.

### Stored results, and which R computed them

gsm.bio's widget records which R computed the results it stores with a page: `computed_by`, with `r_version`, `gsm_bio_version` and `computed_at`. Handed to the connection as `computedBy`, the record comes back with every stored answer, and the footnote names the two versions:

```js
const connection = BioViz.r.createConnection({
  results: statistics.results,
  computedBy: statistics.computed_by // { r_version, gsm_bio_version, computed_at }
});
```

See [the connection's reference](r-connection.md#createconnectionoptions).

## Downloads

Every chart has the two settings, with the same defaults and the same checks.

| Setting     | Default | What it is                                                                                   |
| ----------- | ------- | -------------------------------------------------------------------------------------------- |
| `downloads` | `true`  | Whether the bar of downloads is shown under the footnotes.                                   |
| `png_scale` | `2`     | The PNG's resolution: image pixels per CSS pixel, from 1 to 4. At 2, 192 pixels to the inch. |

The bar has three buttons. Each saves a file named for the chart and the view, the way safety.viz's kit saves its listing (a link to the file, clicked): `bio.viz-{chart}-{view}.png`, `bio.viz-{chart}-{view}-statistics.csv` and `bio.viz-{chart}-{view}-table.csv`, where the view is a few of the chart's placeholders in lower case joined by hyphens: `bio.viz-cross-tab-arm-by-response.png`. A chart's `fileOf(kind)` makes the same file without saving it, a promise of `{ name, blob }`, for `kind` `'png'`, `'statistics'` or `'table'`.

### The PNG

The chart's frame as the page draws it, from the title to the chart's own footnote: the title and subtitle, the notes, what the chart draws, the statistics line and the footnotes. The controls, the hint under the chart, the listing and the bar of downloads are left out. It is drawn at `png_scale` image pixels per CSS pixel, so at the default it is twice the width the frame has on the page, and the file says so: its `pHYs` chunk gives the pixels per metre. Its text chunks (`iTXt`, UTF-8) give its `Title` (the title and subtitle), its `Description` (the footnotes, the chart's own last) and its `Software` (the bio.viz version), so the file still says what it is when it is separated from the page.

The picture is the page's drawing, not a drawing for print: anything bound for a document should come from gsm.bio's static twin of the chart, which draws a vector figure from the same settings.

### The statistics

The statistics R returned for the view drawn, as shown, as one table. For each answer there is a row for R's result (its `part` is `result`) and a row for each of its parts: each estimate (`estimates`), each row of a screen or a grid (`rows`), and so on, numbered by `item`. Every member R returned is a column, a nested one as `outer.inner` (`counts.Placebo`) and a list of values as one field joined by `; `. Each row also names the answer it came from (`asked`), the R function (`function`) and the data it was asked about (`data.…`, the identity a stored result is found by). Every number is R's, written as the shortest text that reads back as the same number. Until R has answered there is nothing to download, and the button waits; a view that asks R nothing, such as the group comparison's overview, offers none.

### The table

The table the chart drew from, one row per participant drawn, with the headings the chart's listing uses: for the cross-tabulation the participant, the row and the column; for the group comparison the participant, the visit, the group and the value; and so on, as each chart's reference says. A number is written as it was drawn, unrounded.

### CSV

Every CSV file, the listing's export among them, is written by RFC 4180: records end in CRLF, and a field or a heading that holds a comma, a double quote, a carriage return or a line feed is written between double quotes with each double quote doubled. A heading that holds a comma is one heading ([bio.viz#39](https://github.com/jwildfire/bio.viz/issues/39)). An empty field is a value the participant does not have; `TRUE` and `FALSE` are written as R reads them.

## The functions of `BioViz.output`

The rules above, for a page or a widget that writes the same words beside a chart.

## `fillText(template, values)`

The template with every placeholder whose name is a key of `values` replaced by the text of its value, and every other left as written. A value that is null or undefined is written as nothing; anything else as `String(value)`. Nothing is evaluated.

```js
BioViz.output.fillText('{measure} at {visit}', { measure: 'CRP', visit: 'Week 4' });
// 'CRP at Week 4'
BioViz.output.fillText('${1 + 1} {unknown}', {});
// '${1 + 1} {unknown}'
```

## `placeholdersIn(template)`

The names of the placeholders a template holds, each once, in the order written.

## `automaticFootnote(parts)`

The footnote a chart writes last.

| Part      | What it is                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date`    | The date drawn, `2026-10-04`.                                                                                                                               |
| `version` | The bio.viz version.                                                                                                                                        |
| `asked`   | What the chart asked R, each `{ answer }` with the answer as the connection gave it, or null while it is on its way. A chart's `statistics()` returns this. |
| `of`      | What R's counts are of, when there are more than four: `'biomarkers'`. Default `'groups'`.                                                                  |

## `countsText(counts, of)`

R's counts as the footnote writes them: a number as `n = 200`; an object of up to four groups as `Placebo n = 95, Treatment n = 91`; more as `n = 179 to 186 across 12 biomarkers`, with `of` naming what they are of. Null when R returned none.

## `toCsv(rows, columns)`

Rows as CSV by RFC 4180, with a heading row: `columns` is a list of `{ value_col, label }`, which field of a row each column holds and its heading. Records end in CRLF.

## `parseCsv(text)`

CSV read back by RFC 4180, every field as text: a list of records, the heading row first. The inverse of `toCsv`.

## `TITLE_DEFAULTS`

The three settings' defaults, which every chart has: `{ title: null, subtitle: null, footnotes: null }`.

## What is not here

- A vector figure (SVG or PDF) from the browser: the PNG is the page's drawing. Vector figures come from gsm.bio's static twins ([obot.roadmap#362](https://github.com/jwildfire/obot.roadmap/issues/362)).
- The specification a chart is written to and rebuilt from ([bio.viz#68](https://github.com/jwildfire/bio.viz/issues/68)).
- Rich text in a title or a footnote: they are plain text. A line break, bold or a link is not drawn.
- A footnote placed anywhere but under the chart, or the chart's own footnote turned off.
