# The connection to R

How a chart gets a statistic. bio.viz computes no statistical test: a chart hands its table to R through a connection and prints what comes back. This page is the interface, for anyone writing a chart, an R function a chart will call, or the stored results a report ships with.

Everything here is exported as `BioViz.r` from the script-tag bundle and as `r` from the ES module bundle. Nothing in it depends on the rest of bio.viz or on safety.viz, so a connection can be handed to any chart as a setting.

## At a glance

```js
const connection = BioViz.r.createConnection({
  results, // stored results, optional
  browser: { sourceUrl: 'statistics.R', packages: ['survival'] } // R in the browser, optional
});

const result = await connection.run('rank_sum', {
  data: rows, // an array of records, one object per row
  args: { value: 'AVAL', group: 'ARM' }, // named arguments
  dataId: 'opening view' // which data this is; only the stored results use it
});

if (result.status === 'ok') {
  footnote.textContent = BioViz.r.formatStatistic(result.value).text;
} else {
  footnote.textContent = result.message;
}
```

## `createConnection(options)`

Returns a frozen object with one method, `run`. Creating a connection loads nothing and requests nothing.

| Option              | Type             | Meaning                                                                                                                                                                      |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `results`           | array            | The precomputed form: [stored results](#stored-results). Omit for none.                                                                                                      |
| `browser`           | object           | The browser form: R started in the page on the first run that needs it. Omit for none. `{}` is enough to reach base R.                                                       |
| `browser.source`    | string           | R source text that defines the functions to call. Evaluated once, when R starts.                                                                                             |
| `browser.sourceUrl` | string           | Instead of `source`: the URL of that file. Fetched on the first run, not before. Give one or the other.                                                                      |
| `browser.packages`  | array of strings | R packages to install and attach before the source is evaluated, for example `['survival']`.                                                                                 |
| `browser.baseUrl`   | string           | Where webR is served from. Default `https://webr.r-wasm.org/v0.6.0/`. A deployment that serves its own copy gives its location; relative locations resolve against the page. |
| `browser.engine`    | object           | Something else to reach R with, in place of webR: `{ start(config), call(name, { data, args }) }`. Used by the tests.                                                        |

A malformed option throws a `TypeError` when the connection is created. That is the only place this interface throws.

With both forms configured, stored results are tried first and R in the browser answers whatever they do not hold. With neither, every answer is `unavailable`.

## `connection.run(name, { data, args, dataId })`

Asks R to call the function `name` with the table first and the arguments after it: in R, `name(data, value = "AVAL", group = "ARM")`.

| Argument | Type             | Meaning                                                                                                                               |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | string           | The R function: one defined by the source the connection was given, or one R already has.                                             |
| `data`   | array of objects | One object per row. Reaches the R function as a data frame with one column per key.                                                   |
| `args`   | object           | Named arguments. A nested object becomes a nested R list.                                                                             |
| `dataId` | any JSON value   | The identity of `data`: which selection of the study it is. Read only by the precomputed form; see [stored results](#stored-results). |

`run` returns a promise that always resolves, to one of three results. It never rejects.

| Result                                       | When                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `{ status: 'ok', value, form }`              | R answered. `value` is what the function returned. `form` is `'precomputed'` or `'browser'`.                    |
| `{ status: 'unavailable', reason, message }` | No R answered. The chart still draws; `message` is a sentence it can print. `reason` is one of the codes below. |
| `{ status: 'error', message }`               | R ran and stopped with an error. `message` is R's own message, with nothing added.                              |

Reasons a result is unavailable:

| `reason`          | Meaning                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `no-r-attached`   | The connection has neither form.                                                                               |
| `not-precomputed` | The connection has only stored results, and none matches this call exactly. The message says what was missing. |
| `load-failed`     | R could not be started in the browser. The message carries the cause. The next run tries again.                |

A call that cannot be made at all (no function name, `data` that is not an array, `args` that is not an object) also resolves to `{ status: 'error', message }`, with a message that begins `bio.viz:`.

R warnings are not carried in the result. An R function that has something to say about its answer says it in the value it returns.

## What R receives and returns

Going in, `data` becomes a data frame built with base R: one column per key found in any record, in the order first seen. Text becomes character (never a factor), numbers numeric, booleans logical. A value that is absent, `undefined`, `null` or not-a-number becomes `NA`. Keep each column to one type.

Coming out, the value is converted with base R and nothing else; no package is needed in the R session:

| R value                            | JavaScript                                                   |
| ---------------------------------- | ------------------------------------------------------------ |
| data frame, at any depth           | array of row objects, one per row: the same shape `data` has |
| named list                         | object                                                       |
| unnamed list                       | array, whatever its length                                   |
| named vector                       | object, whatever its length                                  |
| unnamed vector of length one       | a single number, string or boolean                           |
| unnamed vector of any other length | array                                                        |
| factor, Date, date-time            | text                                                         |
| `NULL`, `NA`                       | `null`                                                       |

A table has one shape whatever its size. A data frame of no rows is an empty array, one row is an array of one object, and every row carries every column, with `NA` as `null`. Row names are not carried; a table that needs them puts them in a column. A column may itself hold lists or data frames, converted by the same rules.

The rule for whoever writes the R function: return a collection as a data frame or an unnamed list, never as a bare vector whose length may be one. A bare vector of length one arrives as a single value, so a chart reading it could not tell one group from a number. Single facts (a p-value, a method's name) are bare vectors of length one; counts by group are a named vector, which is an object at any length.

A value with no plain form, such as a function, is an `error` result.

## Stored results

The precomputed form answers from results worked out ahead of time, by gsm.bio in R, and shipped with the page. It starts nothing and makes no network request.

`results` is an array. Each entry:

```json
{
  "name": "rank_sum",
  "args": { "value": "AVAL", "group": "ARM" },
  "dataId": "opening view",
  "rows": 170,
  "value": {
    "method": "Wilcoxon rank-sum test",
    "p_value": 0.0312,
    "counts": { "Placebo": 86, "Active": 84 }
  }
}
```

| Member   | Required | Meaning                                                                                        |
| -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`   | yes      | The R function that produced the result.                                                       |
| `args`   | no       | The arguments it was called with. Absent means none.                                           |
| `dataId` | yes      | The identity of the data it was computed on.                                                   |
| `rows`   | no       | The number of rows it was computed on. When present, a call must bring exactly that many rows. |
| `value`  | yes      | What the function returned, in the shape the browser form would give.                          |

A call is answered by a stored result only when all of these hold:

- `name` is the same.
- `args` are the same after sorting keys at every depth. Nothing else is normalised: `"ARM"` and `["ARM"]` differ, and so do `1` and `"1"`. Written from R, a single value must be written as a single value (`jsonlite::toJSON(auto_unbox = TRUE)`).
- `dataId` is the same, compared the same way. The call must give one.
- `rows`, if recorded, equals the number of records in `data`.

Anything else is a miss, answered `unavailable` with reason `not-precomputed`, or passed to R in the browser when that form is configured. A stored result is never returned for a call it was not computed for.

Written from R, the value must be in the shape the browser form would give it. With jsonlite that means `auto_unbox = TRUE` and data frames written by row, and it means counts by group are written as a named list: jsonlite drops the names of a named vector. `tools/r-fixtures.R` writes the R check page's stored results with a few lines of base R that follow the table above exactly.

The data identity is stated, not derived. It is whatever the producer and the chart agree to call a selection of the study: a label such as `"opening view"`, or an object describing the filters in force. A fingerprint of the rows was considered and rejected: it would have to be computed identically in R and in JavaScript, and the two do not always read the same decimal text to the same number, so it would miss when it should match. The price of a stated identity is that the chart must state it truthfully: it must change `dataId` whenever a filter changes the rows. `rows` is the cheap cross-check on that.

Two entries with the same name, arguments and data identity are refused when the connection is created, as is any entry missing a required member.

## The browser form

On the first `run` that needs R, and not before, the connection:

1. imports `webr.mjs` from `baseUrl` with a run-time `import()`; webR is not in the bundle and is not an npm dependency;
2. starts webR 0.6.0 on its PostMessage channel, which works on any static host, GitHub Pages included, and is used everywhere so behaviour does not differ by host;
3. installs and attaches `packages`;
4. evaluates the R source once.

Calls made while this is in progress wait for the same start; there is one R session per connection, kept for its lifetime. If the start fails, every waiting call is answered `unavailable` with reason `load-failed`, and the next call starts again.

A copy of webR served from another location must be version 0.6.0. The version is pinned by the default location, not checked.

## `WEBR_VERSION` and `WEBR_BASE_URL`

Two constants, for a page that needs to say which R it runs or to load the same copy itself.

| Constant        | Value                             | Meaning                                                         |
| --------------- | --------------------------------- | --------------------------------------------------------------- |
| `WEBR_VERSION`  | `0.6.0`                           | The version of webR the browser form is written for.            |
| `WEBR_BASE_URL` | `https://webr.r-wasm.org/v0.6.0/` | Where webR is fetched from when `browser.baseUrl` is not given. |

## `formatStatistic(statistic)`

The one place the rules for printing a p-value live. It formats what R returned and computes nothing.

It reads these members of a statistics result:

| Member       | Type             | Meaning                                                                            |
| ------------ | ---------------- | ---------------------------------------------------------------------------------- |
| `method`     | string           | The name of the test.                                                              |
| `p_value`    | number, 0 to 1   | The p-value.                                                                       |
| `counts`     | number or object | The counts used: one whole number, or an object of group name to whole number.     |
| `adjustment` | string           | The multiplicity adjustment applied, if any. Absent, empty or `"none"` means none. |
| `reason`     | string           | Why no number was computed, if none was.                                           |

It returns `{ status, text }`:

| `status`   | When                                                  | `text`                                                                                                       |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `shown`    | Method, counts and a valid p-value are all present.   | `Wilcoxon rank-sum test: p = 0.031 (Placebo n = 86, Active n = 84). Exploratory, unadjusted.`                |
| `withheld` | The result carries a `reason`.                        | `Wilcoxon rank-sum test: not computed, fewer than 5 participants in Placebo (Placebo n = 3, Active n = 84).` |
| `refused`  | The method, the counts or a valid p-value is missing. | `p-value not shown: the result does not name its method.`                                                    |

The rules, from the design:

- Never a p-value alone: without the method's name or the counts, the number is not printed.
- Three decimals. Below 0.001 it prints `p < 0.001`; where it would round to 1.000 it prints `p > 0.999`.
- Labelled `Exploratory, unadjusted.` unless the result names an adjustment, and then `Exploratory, adjusted (Holm).`
- No stars, and never the word significant.
- A reason in place of a number when R declined to compute one.

Stating the filter a result was computed under is the chart's footnote, not this function's.

## Checked against real R

The [R check page](https://jwildfire.github.io/bio.viz/dev/r-check/) runs this interface against real R: a rank-sum test and a log-rank test, through the precomputed form and through R in the browser, each beside the answer desktop R gives, with the megabytes and seconds that starting R in a browser costs. The browser tests named `RCON-LIVE-*` run that page on every pull request.
