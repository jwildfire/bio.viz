#!/usr/bin/env Rscript
# Writes what desktop R says about the cells the group comparison chart draws on
# the synthetic study: for each cell its count, least and greatest value, the
# quantiles a box is drawn at, the mean, and the outline of a violin.
#
#   Rscript tools/r-group-comparison.R                 writes tests/fixtures/group-comparison-r.json
#   Rscript tools/r-group-comparison.R <output file>   writes somewhere else (the check
#                                                      in scripts/check-r-fixtures.mjs)
#
# The chart's own arithmetic (src/group-comparison/structureData.js) is held to
# this file by the unit tests named GC-BOX and GC-VIOLIN. The numbers in it are
# never typed in: rerun this script to change them.
#
# Base R only, and nothing of bio.viz: the tables are read from the vendored CSV
# files, the value types are worked out here from the definitions in
# docs/core.md, and each number is what the R function named beside it returns.
#
#   quantiles   stats::quantile(x, c(.05, .25, .5, .75, .95), type = 7)
#   mean        mean(x)
#   bandwidth   stats::bw.nrd0(x), the default of stats::density()
#   density     at 64 equally spaced heights from min(x) to max(x), the mean of
#               stats::dnorm((height - x) / bandwidth) over x, divided by the
#               bandwidth: a Gaussian kernel density worked out directly, where
#               stats::density() itself approximates on a binned grid
#
# Numbers are written with 17 significant digits, which is enough to read back
# the identical double.

args <- commandArgs(trailingOnly = TRUE)
study <- "site/data/synthetic-study"
if (!file.exists(file.path(study, "synthetic_results.csv"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/group-comparison-r.json"

results <- utils::read.csv(file.path(study, "synthetic_results.csv"), stringsAsFactors = FALSE)
participants <- utils::read.csv(file.path(study, "synthetic_participants.csv"), stringsAsFactors = FALSE)

# One result per participant for a biomarker at a visit, in the participant
# table's order; NA where there is no row or the result is empty.
result_at <- function(measure, visit) {
  rows <- results[results$TEST == measure & results$VISIT == visit, ]
  rows$STRESN[match(participants$USUBJID, rows$USUBJID)]
}

# A value type, from the definitions in docs/core.md, with Baseline the one
# baseline visit.
value_of <- function(measure, visit, value) {
  at <- result_at(measure, visit)
  baseline <- result_at(measure, "Baseline")
  switch(value,
    raw = at,
    baseline = baseline,
    change = at - baseline,
    fold_change = ifelse(baseline > 0, at / baseline, NA),
    percent_change = ifelse(baseline > 0, 100 * (at - baseline) / baseline, NA)
  )
}

num <- function(x) if (is.na(x)) "null" else sprintf("%.17g", x)
nums <- function(x) paste0("[", paste(vapply(x, num, character(1)), collapse = ","), "]")
str <- function(x) if (is.null(x) || is.na(x)) "null" else paste0("\"", x, "\"")

# One cell: the participants at one level of the group, and of the colour when
# there is one. `log` says the violin is drawn on a logarithmic axis, where its
# outline is worked out on the base-10 logarithm of the values.
cell <- function(values, level, color = NA, log = FALSE) {
  x <- values[!is.na(values)]
  quantiles <- stats::quantile(x, c(0.05, 0.25, 0.5, 0.75, 0.95), type = 7, names = FALSE)
  smoothed <- if (log) log10(x) else x
  width <- stats::bw.nrd0(smoothed)
  heights <- seq(min(smoothed), max(smoothed), length.out = 64)
  outline <- vapply(heights, function(height) mean(stats::dnorm((height - smoothed) / width)) / width, numeric(1))
  paste0(
    "{\"level\":", str(level), ",\"color\":", str(color),
    ",\"n\":", length(x),
    ",\"min\":", num(min(x)), ",\"q5\":", num(quantiles[1]), ",\"q25\":", num(quantiles[2]),
    ",\"median\":", num(quantiles[3]), ",\"q75\":", num(quantiles[4]), ",\"q95\":", num(quantiles[5]),
    ",\"max\":", num(max(x)), ",\"mean\":", num(mean(x)),
    ",\"bandwidth\":", num(width),
    ",\"density_at\":", nums(if (log) 10^heights else heights),
    ",\"density\":", nums(outline), "}"
  )
}

# One comparison: a biomarker at a visit with a value type, across the levels of
# a participant column and, optionally, of a second one.
comparison <- function(name, measure, visit, value, group, color = NULL, log = FALSE) {
  values <- value_of(measure, visit, value)
  levels <- sort(unique(participants[[group]]))
  colors <- if (is.null(color)) NA else sort(unique(participants[[color]]))
  cells <- character(0)
  for (level in levels) {
    for (shade in colors) {
      keep <- participants[[group]] == level
      if (!is.null(color)) keep <- keep & participants[[color]] == shade
      cells <- c(cells, cell(values[keep], level, shade, log))
    }
  }
  paste0(
    "    {\"name\":", str(name), ",\"measure\":", str(measure), ",\"visit\":", str(visit),
    ",\"value_type\":", str(value), ",\"group_by\":", str(group),
    ",\"color_by\":", str(if (is.null(color)) NA else color),
    ",\"y_scale\":", str(if (log) "log" else "linear"),
    ",\"cells\":[\n      ", paste(cells, collapse = ",\n      "), "\n    ]}"
  )
}

comparisons <- c(
  comparison("IL-6 change from Baseline to Week 4, by arm", "IL-6", "Week 4", "change", "ARM"),
  comparison("IL-6 at Week 4, by arm and sex", "IL-6", "Week 4", "raw", "ARM", "SEX"),
  comparison("TNF-alpha at Week 12, by response", "TNF-alpha", "Week 12", "raw", "RESPONSE"),
  comparison("CRP fold change at Week 8, by arm", "CRP", "Week 8", "fold_change", "ARM"),
  comparison("Ferritin at Week 2, by sex, on a logarithmic axis", "Ferritin", "Week 2", "raw", "SEX", log = TRUE)
)

lines <- c(
  "{",
  paste0(
    "  \"made_by\": {\"script\":\"tools/r-group-comparison.R\",\"r_version\":",
    str(paste(R.version$major, R.version$minor, sep = ".")),
    ",\"platform\":", str(R.version$platform), "},"
  ),
  "  \"comparisons\": [",
  paste(comparisons, collapse = ",\n"),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s\n", out, paste(R.version$major, R.version$minor, sep = ".")))
