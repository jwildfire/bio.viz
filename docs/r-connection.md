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

| Option              | Type             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `results`           | array            | The precomputed form: [stored results](#stored-results). Omit for none.                                                                                                                                                                                                                                                                                                                                                   |
| `computedBy`        | object           | Which R computed the stored results: `{ r_version, gsm_bio_version, computed_at }`, each text, as gsm.bio's widget records them; `r_version` is needed, the other two may be left out, and `computed_at` is ISO 8601. An answer from the stored results carries it as `computedBy`, and a chart's [last footnote](output.md#the-footnote-the-chart-writes) names the versions and the date. Omit when they are not known. |
| `browser`           | object           | The browser form: R started in the page on the first run that needs it. Omit for none. `{}` is enough to reach base R.                                                                                                                                                                                                                                                                                                    |
| `browser.source`    | string           | R source text that defines the functions to call. Evaluated once, when R starts.                                                                                                                                                                                                                                                                                                                                          |
| `browser.sourceUrl` | string           | Instead of `source`: the URL of that file. Fetched on the first run, not before. Give one or the other.                                                                                                                                                                                                                                                                                                                   |
| `browser.packages`  | array of strings | R packages to install and attach before the source is evaluated, for example `['survival']`.                                                                                                                                                                                                                                                                                                                              |
| `browser.baseUrl`   | string           | Where webR is served from. Default `https://webr.r-wasm.org/v0.6.0/`. A deployment that serves its own copy gives its location; relative locations resolve against the page.                                                                                                                                                                                                                                              |
| `browser.engine`    | object           | Something else to reach R with, in place of webR: `{ start(config), call(name, { data, args }) }`. Used by the tests.                                                                                                                                                                                                                                                                                                     |

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

| Result                                       | When                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{ status: 'ok', value, form }`              | R answered. `value` is what the function returned. `form` is `'precomputed'` or `'browser'`. A stored result also carries `computedBy` when the connection was given it. |
| `{ status: 'unavailable', reason, message }` | No R answered. The chart still draws; `message` is a sentence it can print. `reason` is one of the codes below.                                                          |
| `{ status: 'error', message }`               | R ran and stopped with an error. `message` is R's own message, with nothing added.                                                                                       |

Reasons a result is unavailable:

| `reason`          | Meaning                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `no-r-attached`   | The connection has neither form.                                                                               |
| `not-precomputed` | The connection has only stored results, and none matches this call exactly. The message says what was missing. |
| `load-failed`     | R could not be started in the browser. The message carries the cause. The next run tries again.                |

A call that cannot be made at all (no function name, `data` that is not an array, `args` that is not an object) also resolves to `{ status: 'error', message }`, with a message that begins `bio.viz:`.

R warnings are not carried in the result. An R function that has something to say about its answer says it in the value it returns, as gsm.bio's functions do in `warnings` and `notes`.

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

R's numbers that JSON has no number for are written as text, as gsm.bio's widget writes them: `"Inf"`, `"-Inf"` and `"NaN"`. The connection reads the three back as `Infinity`, `-Infinity` and `NaN`, as the browser form hands them over, in the members that hold a number R may return so: `estimate`, `lower`, `upper`, `value`, `statistic`, `p_value`, `p_unadjusted`, `expected`, `median`, `hazard_ratio`, `hr_lower`, `hr_upper` and `hr_p_value`. Text spelled the same in a name, a group, a category or a note stays text. A stored page then prints Fisher's infinite odds ratio as live R's does: `infinite, 95% confidence interval 14.86 to infinity`. NA is `null`, and an estimate whose number is `null` while R gave a bound is said not to be shown, with the reason, and is never left out.

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

It reads these members of a statistics result, the names gsm.bio's functions return:

| Member       | Type             | Meaning                                                                            |
| ------------ | ---------------- | ---------------------------------------------------------------------------------- |
| `status`     | string           | `"ok"`, `"too_small"` or `"error"`. Absent is read as `"ok"`.                      |
| `method`     | string           | The name of the test.                                                              |
| `p_value`    | number, 0 to 1   | The p-value. One within 0.000000001 above 1 is read as 1 (see the rules).          |
| `counts`     | number or object | The counts used: one whole number, or an object of group name to whole number.     |
| `adjustment` | string           | The multiplicity adjustment applied, if any. Absent, empty or `"none"` means none. |
| `reason`     | string           | Why no number was computed, if none was.                                           |

It returns `{ status, text }`:

| `status`   | When                                                  | `text`                                                                                                 |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `shown`    | Method, counts and a valid p-value are all present.   | `Wilcoxon rank-sum test: p = 0.031 (Placebo n = 86, Active n = 84). Exploratory, unadjusted.`          |
| `withheld` | The result carries a `reason`.                        | `Not computed: Treatment has 3. The minimum group size is 5. Counts: Placebo n = 95, Treatment n = 3.` |
| `error`    | The result's `status` is `"error"`.                   | `R reported an error: Column 'y' (strValueCol) is not numeric.`                                        |
| `refused`  | The method, the counts or a valid p-value is missing. | `p-value not shown: the result does not name its method.`                                              |

The rules, from the design:

- Never a p-value alone: without the method's name or the counts, the number is not printed.
- Three decimals. Below 0.001 it prints `p < 0.001`; where it would round to 1.000 it prints `p > 0.999`.
- A p-value is a number from 0 to 1, and one that is not is refused, not repaired. One allowance: R can return a p-value of 1 a rounding above it, because it is a sum of probabilities (`fisher.test()` gives 1.0000000000000002 for a table no other table is less likely than). A value within 0.000000001 above 1 is read as 1 and printed `p > 0.999`. Anything further above 1, and anything below 0, is refused. The same holds for a row's adjusted and unadjusted p-values.
- Labelled `Exploratory, unadjusted.` unless the result names an adjustment, and then `Exploratory, adjusted (Holm).` An adjustment R names by its `p.adjust` method is printed by its usual name: `holm` as Holm, `hochberg` as Hochberg, `hommel` as Hommel, `bonferroni` as Bonferroni, `BH` and `fdr` as Benjamini-Hochberg, `BY` as Benjamini-Yekutieli. Any other name is printed as given.
- No stars, and never the word significant.
- A reason in place of a number when R declined to compute one, said once. A reason that already begins "Not computed", as gsm.bio's do, is printed as it is, with the counts after it as a sentence of their own. Any other reason is led in by the method's name and the words `not computed`: `Wilcoxon rank-sum test: not computed, fewer than 5 participants in Placebo (Placebo n = 3, Active n = 84).`
- A result R marked as an error is printed as R's message, after `R reported an error:`, with the counts where R knew them and no number.

Stating the filter a result was computed under is the chart's footnote, not this function's.

## `formatEstimate(estimate)`

Formats one estimate R returned: one row of a result's `estimates`. It reads `name`, `group` (what it is an estimate of), `estimate`, and the interval as `lower`, `upper` and `level`.

It returns `{ status, text }`:

| `status`  | When                                                                                        | `text`                                                                                      |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `shown`   | The estimate has a name and a number, and a whole interval.                                 | `Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.` |
| `shown`   | The estimate has a name and a number, and R gave no interval.                               | `Mean (Placebo): 0.02473.`                                                                  |
| `shown`   | R gave an infinite estimate or bound, as Fisher's odds ratio of a table with an empty cell. | `odds ratio: infinite, 95% confidence interval 14.86 to infinity.`                          |
| `refused` | It has no name, no number (not-a-number among them), or an interval with a part missing.    | `Estimate not shown: the interval of Difference in means is incomplete.`                    |

Each number is printed to four significant figures, without trailing zeros, and is otherwise R's: nothing is computed, and an interval is never completed or widened here. The level is printed as a percentage, `0.95` as `95%`.

## `formatMedian(estimate)`

Formats one median survival time R returned: a row of `estimates` from gsm.bio's `Analyze_Survival`, named `Median`. It reads `name`, `group`, `estimate`, and the interval as `lower`, `upper` and `level`. R gives no median, or no bound, where the curve or its band did not fall to one half, and says so in its note; that part reads `not reached`.

| `status`  | When                                                                      | `text`                                                                   |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `shown`   | The median has a name and a level, and each part is a number or missing.  | `Median (≤ 2.783): 23.32, 95% confidence interval 17.32 to not reached.` |
| `shown`   | R reached no median and no bound.                                         | `Median (Late): not reached, 95% confidence interval not reached.`       |
| `refused` | It has no name, a part that is neither a number nor missing, or no level. | `Estimate not shown: the interval of Median has no level.`               |

Each number is printed to four significant figures, as `formatEstimate` prints one, and is otherwise R's: nothing is computed, and a missing part is never filled in.

## `formatComparison(comparison)`

Formats one comparison of two groups from a result's `rows`, such as one pairwise comparison, by the rules a whole result is held to: its p-value is given only with its method, the two groups' counts and its label. It reads `group_1`, `group_2`, `n_1`, `n_2`, `method`, `p_value` (the adjusted one, when R adjusted), `adjustment`, `status` and `reason`.

It returns the sentence, and its parts for a chart that prints the comparisons as a table:

| Member       | Meaning                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `shown`, `withheld`, `error` or `refused`, as `formatStatistic` gives them. A row that names no two groups is `refused`.                                  |
| `text`       | The whole sentence: `Placebo F and Treatment F: Welch Two Sample t-test: p < 0.001 (Placebo F n = 42, Treatment F n = 42). Exploratory, adjusted (Holm).` |
| `result`     | The same without the pair's name.                                                                                                                         |
| `groups`     | The two groups' names, or null.                                                                                                                           |
| `n`          | Their two counts, or null when either is not a whole number.                                                                                              |
| `method`     | The method's name. Null unless `status` is `shown`.                                                                                                       |
| `p`          | The p-value as printed, `p = 0.031`. Null unless `status` is `shown`.                                                                                     |
| `adjustment` | The adjustment by its usual name, or null when the p-value is unadjusted or not shown.                                                                    |
| `label`      | `Exploratory, adjusted (Holm).` or `Exploratory, unadjusted.` Null unless `status` is `shown`.                                                            |

A table built from the parts prints `p` only beside the pair's counts and under a caption that carries `method` and `label`.

## `formatGroup(row)`

Formats one group's result from a result's `rows`: an estimate R computed within one group, such as a correlation coefficient in one arm, with its interval, the group's count and its p-value. The p-value is held to the rules a whole result is held to. It reads `group`, `counts`, `estimate`, `lower`, `upper`, `level`, `method`, `p_value`, `adjustment`, `status` and `reason`.

It returns the sentence, and its parts for a chart that prints the groups as a table:

| Member       | Meaning                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `shown`, `withheld`, `error` or `refused`, as `formatStatistic` gives them. A row that names no group, or has no estimate or half an interval, is `refused`.         |
| `text`       | The whole sentence: `Placebo: 0.5918, 95% confidence interval 0.4474 to 0.7061. Pearson's product-moment correlation: p < 0.001 (n = 100). Exploratory, unadjusted.` |
| `result`     | The same without the group's name.                                                                                                                                   |
| `group`      | The group's name, or null.                                                                                                                                           |
| `n`          | Its count, or null when it is not a whole number.                                                                                                                    |
| `estimate`   | The estimate as printed, to four significant figures. Null unless `status` is `shown`.                                                                               |
| `interval`   | Its interval in words, `95% confidence interval 0.4474 to 0.7061`. Null where R gave none, as for Spearman's rho, and unless `status` is `shown`.                    |
| `bounds`     | The two ends alone, `0.4474 to 0.7061`, for a table whose header carries the level. Null where `interval` is.                                                        |
| `level`      | The level alone, `95%`. Null where `interval` is.                                                                                                                    |
| `method`     | The method's name. Null unless `status` is `shown`.                                                                                                                  |
| `p`          | The p-value as printed, `p = 0.031`. Null unless `status` is `shown`.                                                                                                |
| `adjustment` | The adjustment by its usual name, or null when the p-value is unadjusted or not shown.                                                                               |
| `label`      | `Exploratory, adjusted (Holm).` or `Exploratory, unadjusted.` Null unless `status` is `shown`.                                                                       |

No interval is made up: where R returned none, none is printed. A group R could not compute for, one with too few pairs, gives R's reason and its count and no number: `Treatment: Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.`

## `formatPair(row)`

Formats one pair's result from a correlation matrix's `rows`: the coefficient R computed for two of a grid's variables, with its interval and the number of complete pairs it used. It prints no p-value, by design: a grid of coefficients is not a grid of tests, and gsm.bio's `Analyze_CorrelationMatrix` returns none. It reads `x`, `y`, `counts`, `estimate`, `lower`, `upper`, `level`, `status` and `reason`, and nothing else: a p-value on a row is neither read nor printed.

It returns the sentence, and its parts for a cell and for a table:

| Member     | Meaning                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | `shown`, `withheld`, `error` or `refused`, as `formatStatistic` gives them. A row that does not name its two variables, or has no count, no estimate or half an interval, is `refused`. |
| `text`     | The whole sentence: `0.6384, 95% confidence interval 0.5482 to 0.7139 (n = 200).`                                                                                                       |
| `pair`     | The two variables' names as R gave them, `['v9', 'v11']`, or null.                                                                                                                      |
| `n`        | The number of complete pairs, or null when it is not a whole number.                                                                                                                    |
| `estimate` | The estimate as printed, to four significant figures. Null unless `status` is `shown`.                                                                                                  |
| `interval` | Its interval in words, `95% confidence interval 0.5482 to 0.7139`. Null where R gave none, as for Spearman's rho, and unless `status` is `shown`.                                       |
| `bounds`   | The two ends alone, `0.5482 to 0.7139`, for a table whose header carries the level. Null where `interval` is.                                                                           |
| `level`    | The level alone, `95%`. Null where `interval` is.                                                                                                                                       |

No interval is made up: where R returned none, none is printed. A pair R could not compute for, one with too few complete pairs, gives R's reason and its count and no number: `Not computed: 178 complete pairs. The minimum is 183. Counts: n = 178.`

## `formatScreenRow(row, groups)`

Formats one row of a biomarker screen's `rows`: one biomarker's estimate, a standardised difference or a coefficient, with its interval, the counts it used, and its p-value twice, as R computed it, unadjusted, and as R adjusted it across the rows that have one. Both are held to the rules a whole result is held to: never without the method and the counts, labelled exploratory, the adjustment named, no star and no verdict. It reads `biomarker`, `counts`, `n_1`, `n_2`, `estimate`, `lower`, `upper`, `level`, `method`, `p_unadjusted`, `p_value`, `adjustment`, `adjusted_over`, `status` and `reason`. `groups`, for a difference, names the two groups so the counts say whose they are.

It returns the sentence, and its parts for a table:

| Member       | Meaning                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `shown`, `withheld`, `error` or `refused`, as `formatStatistic` gives them. A row with no biomarker, no method, no counts, no estimate, half an interval, no adjustment, no number of rows adjusted across or an adjusted p-value that is not one is `refused`. |
| `text`       | The whole sentence: `IL-6: 0.9133, 95% confidence interval 0.6111 to 1.213. Welch Two Sample t-test: p < 0.001 unadjusted, p < 0.001 adjusted across 12 biomarkers (Placebo n = 95, Treatment n = 91). Exploratory, adjusted (Benjamini-Hochberg).`             |
| `result`     | The same without the biomarker's name.                                                                                                                                                                                                                          |
| `biomarker`  | The biomarker's name, or null.                                                                                                                                                                                                                                  |
| `n`          | The counts in words, `Placebo n = 95, Treatment n = 91` or `n = 200`, or null.                                                                                                                                                                                  |
| `estimate`   | The estimate as printed, to four significant figures. Null unless `status` is `shown`.                                                                                                                                                                          |
| `interval`   | Its interval in words with its level. Null where R gave none, as for Spearman's rho, and unless `status` is `shown`.                                                                                                                                            |
| `bounds`     | The two ends alone. Null where `interval` is.                                                                                                                                                                                                                   |
| `level`      | The level alone, `95%`. Null where `interval` is.                                                                                                                                                                                                               |
| `method`     | The method's name. Null unless `status` is `shown`.                                                                                                                                                                                                             |
| `p`          | The unadjusted p-value as printed, `p = 0.031`. Null unless `status` is `shown`.                                                                                                                                                                                |
| `adjusted`   | The adjusted p-value as printed. Null unless `status` is `shown`.                                                                                                                                                                                               |
| `adjustment` | The adjustment by its usual name, `Benjamini-Hochberg` or `Holm`. Null unless `status` is `shown`.                                                                                                                                                              |
| `over`       | How many rows R adjusted across. Null unless `status` is `shown`.                                                                                                                                                                                               |
| `label`      | `Exploratory, adjusted (Benjamini-Hochberg).` Null unless `status` is `shown`.                                                                                                                                                                                  |

A row R could not compute gives R's reason and its counts and no number: `CRP: Not computed: Placebo has 2; Treatment has 2. The minimum group size is 5. Counts: Placebo n = 2, Treatment n = 2.`

## `formatLevel(row, of)`

Formats one level's result from a by-level answer's `rows`: the test of the groups R ran on the rows of one level of a column, a visit say, as gsm.bio's `Analyze_GroupDifferenceBy` returns it, one row per level. The p-value printed is R's `p_value`, which R adjusted across the levels that have one when it names an adjustment, and it is held to the rules a whole result is held to: never without the method and each group's count, labelled exploratory, the adjustment named, no star and no verdict. It reads `by`, the groups in `group_1`, `group_2` and so on with each one's count in `n_1`, `n_2` and so on, however many there are, and `method`, `p_unadjusted`, `p_value`, `adjustment`, `adjusted_over`, `status` and `reason`. `of` is what a level is called in the sentence, in the singular: `'level'` unless given, `'visit'` for the [group comparison chart](group-comparison.md#the-test-under-each-visit).

It returns the sentence, and its parts for a table:

| Member       | Meaning                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `shown`, `withheld`, `error` or `refused`, as `formatStatistic` gives them. A row with no level, fewer than two groups named, no method, no counts, no unadjusted p-value, or an adjustment and no number of levels it covered is `refused`. |
| `text`       | The whole sentence: `Baseline: Welch Two Sample t-test: p = 0.221 (Placebo n = 100, Treatment n = 100). Exploratory, unadjusted.`                                                                                                            |
| `result`     | The same without the level's name.                                                                                                                                                                                                           |
| `by`         | The level, or null.                                                                                                                                                                                                                          |
| `groups`     | The groups, in the order R names them, or null.                                                                                                                                                                                              |
| `n`          | Each group's count, in that order, or null.                                                                                                                                                                                                  |
| `method`     | The method's name. Null unless `status` is `shown`.                                                                                                                                                                                          |
| `p`          | The p-value to print, R's `p_value`: `p = 0.579`. Null unless `status` is `shown`.                                                                                                                                                           |
| `unadjusted` | The p-value R computed before any adjustment, R's `p_unadjusted`, as printed. Null unless `status` is `shown`.                                                                                                                               |
| `adjustment` | The adjustment by its usual name, `Holm` or `Benjamini-Hochberg`, or null when the p-value is unadjusted.                                                                                                                                    |
| `over`       | How many levels R adjusted across, or null when the p-value is unadjusted.                                                                                                                                                                   |
| `label`      | `Exploratory, unadjusted.` or `Exploratory, adjusted (Holm).` Null unless `status` is `shown`.                                                                                                                                               |

An adjusted p-value is given beside the unadjusted one: `Week 12: Welch Two Sample t-test: p = 0.193 unadjusted, p = 0.579 adjusted across 3 visits (Placebo n = 5, Treatment n = 5). Exploratory, adjusted (Holm).` A level R could not compute gives R's reason and each group's count and no number: `Week 2: Not computed: Treatment has 1. The minimum group size is 5. Counts: Placebo n = 6, Treatment n = 1.`

## Checked against real R

The [R check page](https://jwildfire.github.io/bio.viz/dev/r-check/) runs this interface against real R: a rank-sum test and a log-rank test, through the precomputed form and through R in the browser, each beside the answer desktop R gives, with the megabytes and seconds that starting R in a browser costs. The browser tests named `RCON-LIVE-*` run that page on every pull request.

The [group comparison chart](group-comparison.md#the-statistics-line) is the first chart to use it: its demo starts R in the browser with gsm.bio's statistics file, and the browser tests named `GC-STAT-034` to `GC-STAT-042` hold what it prints to desktop R.
