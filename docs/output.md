# Getting results out

What every chart does so that what it shows can leave the browser and still say what it is: a title, a subtitle and footnotes written with placeholders the chart fills from the view it draws, and one footnote the chart always writes last, saying when and by what the figure was drawn and what stands behind each statistic it printed. The rules are written once, in `src/shared/titles.js`, and every chart follows them; a page or a widget that writes the same words reaches them as `BioViz.output`.

Under the footnotes each chart offers three downloads: a PNG of the chart with its title and footnotes drawn in, the statistics R returned as CSV, and the table the chart drew from as CSV. And every chart writes its specification, its settings and filters as JSON data, from which `BioViz.fromSpecification` makes the same chart again: the format gsm.bio's batch runner reads ([obot.roadmap#362](https://github.com/jwildfire/obot.roadmap/issues/362)). All of it is the requirement [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361).

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
> Drawn on 2026-10-04 by bio.viz 0.3.0. Statistics: Welch Two Sample t-test (Placebo n = 95, Treatment n = 91); computed by R in this browser.

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
- What comes out is written on the page as text, never as markup; each value is set apart in a `<bdi>`, so a value written right to left keeps its direction to itself.
- A title or a subtitle of only white space is none.

Every chart fills these three:

| Placeholder | What it holds                                                           |
| ----------- | ----------------------------------------------------------------------- |
| `{filters}` | The filters in force, in words (`Sex is F; Arm is Placebo`), or `none`. |
| `{date}`    | The date drawn, in UTC, as ISO 8601: `2026-10-04`.                      |
| `{version}` | The bio.viz version, as the chart's own footnote says it.               |

Each chart adds its own, listed in its reference under Titles and footnotes: [group comparison](group-comparison.md#titles-and-footnotes), [association scatter](association-scatter.md#titles-and-footnotes), [correlation matrix](correlation-matrix.md#titles-and-footnotes), [biomarker screen](biomarker-screen.md#titles-and-footnotes), [cross-tabulation](cross-tab.md#titles-and-footnotes) and [stratified survival](stratified-survival.md#titles-and-footnotes). Every chart has `{n}`, the participants it draws.

## Where they are drawn

The title and the subtitle are drawn at the top of the chart's own frame, above its toolbar, notes and figure; the footnotes at the bottom of it, under the figure and the statistics line and above the listing. They are part of the chart's element, so they move, wrap and print with it, and at a 390-pixel viewport they wrap like any other text, with no horizontal scroll. The title is a heading of level 2 to assistive technology.

## The footnote the chart writes

The last footnote is the chart's, and it says three things:

1. The date the chart was drawn, in UTC, and the bio.viz version that drew it: `Drawn on 2026-10-04 by bio.viz 0.3.0.` A build with changes made since its release says so, `bio.viz 0.3.0 with development changes`, so the footnote never names a release for code that is not one. The package's `bioviz.development` says which it is: true between a release and the preparation of the next, when the release log holds the package's version as released and another section is upcoming; false while a release is prepared, once its section is promoted, and in a tagged build. A unit test fails when the flag and the log disagree.
2. For every statistic printed, every method R used, the counts R used, as R returned them, and every adjustment of its p-values (`p-values adjusted by Holm`, `by Benjamini-Hochberg`); with a pairwise test, the overall test first, `Kruskal-Wallis rank sum test, with Wilcoxon rank sum test with continuity correction (…), p-values adjusted by Holm`. Its form: `Welch Two Sample t-test (Placebo n = 95, Treatment n = 91)`. One count is written `n = 200`; up to four groups each by name; more, such as a screen's biomarkers, as the least and the most with how many there are: `n = 179 to 186 across 12 biomarkers`.
3. Which R computed them, as the connection says: `computed by R in this browser` for R started in the page; for a result stored with the page, `computed by R 4.3.3 with gsm.bio 0.2.0 on 2026-10-01, stored with the page` when the connection was told the versions and the date (`computedBy`, below), and `stored with the page` when it was not; for any other form, `computed by R`.

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

The chart's frame as the page draws it, from the title to the chart's own footnote: the title and subtitle, the notes, what the chart draws, the statistics line and the footnotes. What a reader works the chart with is left out: every element marked `bv-no-picture`, which the toolbar, the hint under the chart, the listing, the bar of downloads, a chart's own download buttons and the overview's pager buttons are. A chart's marks (the matrix's discs and key, the screen's zero line, intervals and dots, the bars and curves) are drawn at the size the page draws them, and text finds its own height. What scrolls sideways on the page, such as the survival chart's at-risk table on a phone, is drawn whole, and the picture is as wide as it needs to be.

It is drawn at `png_scale` image pixels per CSS pixel, so at the default it is twice the width the frame has on the page, and the file says so: its `pHYs` chunk gives the pixels per metre. Each Chart.js canvas is drawn again at that resolution for the picture, so the plotted marks are as sharp as the text. Its text chunks (`iTXt`, UTF-8) are three, and there is nothing else in it: its `Title` (the title and subtitle), its `Description` (the footnotes, one a line, the chart's own last) and its `Software`, the software that made it and its version, as the footnote says it (`bio.viz 0.3.0`). So the file still says what it is when it is separated from the page, and it holds no date, no file path and no data.

When the picture cannot be made, the bar says so in a line of its own, where the reader sees it: a browser will not write a canvas larger than it allows (Safari about 16.7 million pixels, which a tall screen at `png_scale` 4 can pass), will not read one it has been given a picture from elsewhere, or cannot read the drawing. Another download, or a smaller `png_scale`, can follow.

The picture is the page's drawing, not a drawing for print: anything bound for a document should come from gsm.bio's static twin of the chart, which draws a vector figure from the same settings.

### The statistics

The statistics R returned for the view drawn, as shown, as one table. For each answer there is a row for R's result (its `part` is `result`) and a row for each of its parts: each estimate (`estimates`), each row of a screen or a grid (`rows`), and so on, numbered by `item`. Every member R returned is a column, by its path: a nested member's names joined by a slash (`counts/Placebo`, so R's own dotted names, `p.value`, stay as they are), a list's entries by their place (`data/variables/1/measure`, the variable the grid's `v1` stands for), and a list of values alone as one field, joined by `|` (R's notes may hold a `;`). Each row also names the answer it came from (`asked`), the R function (`function`) and the data it was asked about (`data/…`, the identity a stored result is found by). A member of R's answer that would take one of those names, or two members written alike, is refused, not overwritten. Every number is R's, written as the shortest text that reads back in JavaScript as exactly the same number; R's own reader reads about one in fourteen such numbers one unit in the last place away. NaN, Inf and -Inf are written as R writes them, and a value missing as an empty field. Until R has answered there is nothing to download, and the button waits, saying so; a view whose statistics are unavailable says that instead; a view that asks R nothing, such as the group comparison's trend tiles, offers none.

### The table

The table the chart drew from, one row per participant drawn, with the headings the chart's listing uses: for the cross-tabulation the participant, the row and the column; for the group comparison the participant, the visit, the group and the value, for one biomarker over time one such row per participant and visit, and on its trend tiles of every biomarker one row per participant, biomarker and visit, with the biomarker named; and so on, as each chart's reference says. A group or a category that is a cut biomarker has the value it was cut from beside it (`CRP at Baseline`), so the cut can be made again from the file. A number is written as it was drawn, unrounded.

### CSV

Every CSV file, the listing's export among them, is written by RFC 4180: records end in CRLF, and a field or a heading that holds a comma, a double quote, a carriage return or a line feed is written between double quotes with each double quote doubled. A heading that holds a comma is one heading ([bio.viz#39](https://github.com/jwildfire/bio.viz/issues/39)). An empty field is a value the participant does not have; `TRUE` and `FALSE` are written as R reads them.

Values are written as they are, so a file reads back into R exactly. Two things follow for a spreadsheet:

- Excel and other spreadsheets run a field that begins with `=`, `+`, `-` or `@` as a formula. A value from a table, a label or a note can begin that way; open a downloaded file with its columns imported as text, or in a reader that does not run formulas, when its contents are not your own.
- The files are UTF-8 with no byte-order mark. Excel on Windows reads a CSV opened by a double click in the system's own code page, so `≤`, `–` and other characters come out wrong; use Data → From Text/CSV and choose UTF-8.

## Specifications

A chart's `specification()` returns what it draws as JSON data, and `BioViz.fromSpecification(element, specification)` makes the same chart from it. The tables are not in it: the chart made from it is given them with `init`, as any chart is.

```js
const saved = JSON.stringify(chart.specification());
// later, or on another page, or in gsm.bio's batch runner:
BioViz.fromSpecification('#chart', saved, { connection }).init({ results, participants });
```

```json
{
  "format": "bio.viz specification",
  "format_version": 1,
  "bio_viz_version": "0.3.0",
  "chart": "cross-tab",
  "settings": {
    "row_by": "ARM",
    "col_by": "RESPONSE",
    "percent": "row",
    "test": "chisq",
    "title": "{rows} by {columns}",
    "filters": [{ "value_col": "SEX", "label": "Sex" }],
    "…": "every other setting the chart has"
  },
  "filters": [{ "column": "SEX", "operator": "in", "values": ["F"] }]
}
```

| Member            | What it is                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`          | `"bio.viz specification"`: what the object is.                                                                                                                                                                                                                             |
| `format_version`  | `1`: the version of this format. A specification of another format version is refused, with a sentence that says which it is.                                                                                                                                              |
| `bio_viz_version` | The bio.viz version that wrote it: text, and needed. It is not compared: a specification from another version is read if what it holds is still what this version has (below).                                                                                             |
| `chart`           | The chart: `group-comparison`, `association-scatter`, `correlation-matrix`, `biomarker-screen`, `cross-tab` or `stratified-survival`.                                                                                                                                      |
| `settings`        | Every setting of the chart, by the names in its reference, as its controls now read: the biomarker, the visit, the groups, the test and so on, with its title, subtitle and footnotes. Left out, a setting keeps its default.                                              |
| `filters`         | Every filter in force: `{ column, operator, values }`, the column of the participant table it reads, `"in"`, and the values it lets through. A filter at All is not listed; a filter of several values unticked to none is listed with no values, and lets nobody through. |

The chart writes every setting it has, as the controls now read, so a chart made from its specification opens on the same view and writes the same specification again. The filters a chart offers are in its `filters` setting, each without where it starts; where each is now is in the specification's `filters`, and reading one lays it back onto its filter as where that filter starts.

### Nothing is evaluated

A specification is data: text, numbers, `true`, `false`, `null`, lists and objects. It holds no function, expression or template that runs, and a title or a value that looks like code is text, filled and drawn as text. Two settings are the page's and never written: `connection`, the connection to R, and `back`, a way back; the page gives them again, as the third argument of `fromSpecification`. Anything else that is not data is refused.

### What is refused

Each with a sentence that names what is wrong:

- an object that is not a specification, or of another format version;
- a chart bio.viz does not have;
- a setting the chart does not have in this version: an older or newer specification is read when every setting it holds is still a setting, and otherwise refused naming the ones that are not;
- a setting whose value the chart refuses, with the chart's own sentence;
- a filter whose operator is not `in`, that names no column, or a column another filter is on, or a value twice;
- `__proto__`, `constructor` or `prototype` as a column, or as the column a setting names;
- an object whose property is a getter or a setter, or that nests more than 64 deep;
- anything that is not data.

### The filter rules

- A filter reads a column of the participant table, and only that table: a column the results table alone has is not a filter. The participant's id is never a filter.
- A value is compared as text: `35` and `"35"` are one value.
- A filter lets through the participants whose value is one of its values. Filters together are combined with AND: a participant passes when every filter lets them through.
- A filter that is not listed is at All. A column is filtered once: a specification that lists one twice is refused.

### The value shapes

Every value is JSON data, in one of these shapes, as each chart's reference gives its settings:

| Shape                 | Written as                                                                             | For                                               |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A column              | its name, `"ARM"`                                                                      | `row_by`, `group_by`, `color_by`, every `*_col`   |
| A column with a label | `{ "value_col": "ARM", "label": "Arm" }`                                               | `groups`, `filters`, `numbers`, `details`         |
| A biomarker           | its name, `"CRP"`                                                                      | `start_value`, `measure`                          |
| A list of names       | `["Week 4", "Week 8"]`; `[]` is none, where a control can be emptied, `null` every one | `visits`, `levels`, `biomarkers`, `measures`      |
| A variable            | `{ "measure": "CRP", "visit": "Baseline", "value": "raw" }` or `{ "col": "AGE" }`      | `x`, `y`, `with`                                  |
| A cut variable        | a variable with `"cut"`: `"median"`, `"tertiles"`, `"quartiles"` or `[2.5, 4]`         | `group_by`, `row_by`, `col_by`, `cuts`            |
| A choice              | one of the words the setting lists                                                     | `test`, `percent`, `comparison`, `method`, `sort` |
| A number              | `20`, `0`                                                                              | `limit`, `page`, `png_scale`                      |
| Text                  | `"{rows} by {columns}"`                                                                | `title`, `subtitle`, `footnotes`                  |

Which setting holds the biomarker each chart draws:

| Chart                 | The biomarker                                              |
| --------------------- | ---------------------------------------------------------- |
| `group-comparison`    | `start_value`, at `visits` with `value_type`               |
| `association-scatter` | `x` and `y`, each a variable                               |
| `correlation-matrix`  | `biomarkers` at `visit`, or `measure` at `visits` (`mode`) |
| `biomarker-screen`    | every biomarker (`measures`), at `visit` with `value_type` |
| `cross-tab`           | `row_by` or `col_by`, when either is a cut variable        |
| `stratified-survival` | `group_by`, when it is a cut variable                      |

Every setting's default is in the chart's reference and in the schema, as each setting's `default`: a setting left out of a specification takes it.

### A list of specifications

Several specifications together are a JSON array of specification objects, each read on its own: `[{ "format": "bio.viz specification", … }, …]`. gsm.bio's batch runner reads such a list.

### What the data cannot draw

A specification may ask for something the tables do not have: a grouping by a column they lack, a filter on one, a value a filter does not offer. The chart then draws what it can, as it would from settings, and says what it did not draw, in a line above it and in `chart.notices`, a list a caller such as gsm.bio's batch runner can read once the chart has drawn on its tables:

```js
const chart = BioViz.fromSpecification('#chart', spec).init(tables);
chart.notices;
// [{ kind: 'setting', name: 'row_by', asked: 'NOPE', drawn: 'ARM',
//    said: 'Rows: NOPE is not in the tables, so the chart draws ARM.' },
//  { kind: 'filter', name: 'SEX', asked: ['X'], drawn: null,
//    said: 'Filter SEX: X is not one of its values, so it is at All.' }]
```

`kind` is `setting` or `filter`; `name` the setting or the column; `asked` what the specification asked for; `drawn` what the chart draws instead, `null` for none or All; `said` the sentence. A chart's own specification, read back on the same tables, has no notices.

### What a specification holds of the view, and what it does not

It holds every setting as the controls read: the groupings, the visits, the test, the filters, what the group comparison's trend tiles draw, what one biomarker over time is drawn as and how its p-values are adjusted across the visits, and whether it draws unscheduled visits (`tile_summary`, `time_mark`, `visit_adjustment`, `unscheduled_visits`), the page of the screen (`page`), the screen's order (`sort`), and the cut variables the Rows, Columns and Groups controls offer (`cuts`), a line moved on the survival chart among them. Made from it on the same tables, a chart opens on the same view and writes the same specification again.

It does not hold what a reader does in passing, which ends when the chart draws again: a chart opened in place of another (a screen's row, a matrix's cell), the participants listed from a cell, a box, a region or a curve, the participant profile open beside it, and a cut line while it is being dragged.

### Versions

`format_version` changes when a member of the format, or the meaning of a setting, changes; a specification of another format version is refused. Within one format version, a release of bio.viz that adds a setting gives it a default that keeps the old behaviour, so a specification written before it is read and draws as it did; one that holds a setting a release has removed is refused, naming the setting.

The schema's `$id`, https://jwildfire.github.io/bio.viz/schema/specification.json, resolves once a release with specifications is published from `main`; until then the file is at `dev/schema/specification.json`.

### The schema

The format is a JSON Schema (2020-12), committed as `src/data/specification.schema.json` and published at [`schema/specification.json`](https://jwildfire.github.io/bio.viz/dev/schema/specification.json). It is written from each chart's own settings by `node tools/write-specification-schema.mjs`, so it names, for each chart, exactly the settings it has; the unit tests fail when the committed file is not what the charts make, and every specification the browser tests write is validated against it. gsm.bio's batch runner reads specifications by this schema.

## `fromSpecification(element, specification, page)`

Makes the chart a specification names in an element, with its settings and filters. `specification` is the object or its JSON text; `page` holds what a specification never does, `connection` and `back`, and nothing else. Returns the chart; give it the tables with `init`.

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

## `fillParts(template, values)`

The template filled, as its runs of text: `[{ text, value }]`, each placeholder's value a run of its own (`value: true`), so a page can set values apart, as the charts do with `<bdi>`, without reading anything as markup.

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

R's counts as the footnote writes them: a number as `n = 200`; an object of up to four groups as `Placebo n = 95, Treatment n = 91`; five or more as `n = 179 to 186 across 12 biomarkers`, with `of` naming what they are of. A count written as text that reads as a number is read as that number. Null when R returned none.

## `toCsv(rows, columns)`

Rows as CSV by RFC 4180, with a heading row: `columns` is a list of `{ value_col, label }`, which field of a row each column holds and its heading. Records end in CRLF.

## `parseCsv(text)`

CSV read back by RFC 4180, every field as text: a list of records, the heading row first. The inverse of `toCsv`.

## `readSpecification(specification)`

Reads a specification without making a chart, with every check `fromSpecification` makes: returns `{ chart, settings, version }`, the chart's name, the settings it would be made with and the version that wrote it, or refuses with a sentence.

## `SPECIFICATION_FORMAT`

What a specification says it is: `bio.viz specification`.

## `SPECIFICATION_VERSION`

The version of the format this library writes and reads: `1`.

## `FILTER_OPERATORS`

The operators a filter may have: `in`, the values it lets through.

## `TITLE_DEFAULTS`

The three settings' defaults, which every chart has: `{ title: null, subtitle: null, footnotes: null }`.

## What is not here

- A vector figure (SVG or PDF) from the browser: the PNG is the page's drawing. Vector figures come from gsm.bio's static twins ([obot.roadmap#362](https://github.com/jwildfire/obot.roadmap/issues/362)).
- The interface that collects specifications while someone explores belongs to an app.
- Running a specification against a dataset, or one across every biomarker: gsm.bio's batch runner ([obot.roadmap#362](https://github.com/jwildfire/obot.roadmap/issues/362)).
- Rich text in a title or a footnote: they are plain text. A line break, bold or a link is not drawn.
- A footnote placed anywhere but under the chart, or the chart's own footnote turned off.
