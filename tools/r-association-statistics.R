#!/usr/bin/env Rscript
# Writes the expected results for the association scatter's statistics line and
# fitted line: what desktop R answers when it runs gsm.bio's statistics file, as
# vendored in site/vendor/gsm.bio/statistics.R, on the rows the chart hands R.
#
#   Rscript tools/r-association-statistics.R                 writes tests/fixtures/association-statistics-r.json
#   Rscript tools/r-association-statistics.R <output file>   writes somewhere else (the check
#                                                            in scripts/check-r-fixtures.mjs)
#
# The rows are not worked out here. Each case in
# tests/fixtures/association-statistics/ is one panel of the gallery's demo
# chart, and its CSV file holds the rows the chart's own code made for that
# panel (tools/derive-association-statistics.mjs). This script reads them, calls
# the function the chart calls with the arguments the chart sends, and writes
# each answer as a stored result: the function's name, its arguments, the
# identity of the rows, the number of rows and what R returned.
#
# One thing is done here as the chart does it: on a logarithmic axis the chart
# hands R the base-10 logarithm of `x` or `y`, the values as plotted, so this
# script takes log10() of that column before it calls the function. The files
# hold the values themselves, because a logarithm taken in JavaScript is not the
# same to the last binary place in every engine and a committed file must be.
#
# The name, the arguments and the identity are written by
# `association_scatter_key` below from what an R user knows of a view: the
# settings, by the chart's own names. That function is the recipe in
# docs/association-scatter.md, and the unit tests hold what it writes to what
# the chart asks, so a stored result written this way is found by the chart.
#
# The file records the R version that made it and the commit and checksum of the
# statistics file it sourced. The numbers in it are never typed in: rerun this
# script to change them.
#
# Base R and the stats package only: Analyze_Correlation and Analyze_Fit need
# nothing else. The JSON is written by hand (tools/r-json.R).

args <- commandArgs(trailingOnly = TRUE)
fixture <- "tests/fixtures/association-statistics"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/association-statistics-r.json"

source(file.path(vendored, "statistics.R"))
source("tools/r-json.R")

# ---- The recipe: the key of one panel's stored result ------------------------
#
# dfRows   the panel's rows, one per participant: the id, `x`, `y`, and `color`
#          and `panel` when the view has them. On a logarithmic axis `x` or `y`
#          is the base-10 logarithm of the value: log10().
# lView    the view, by the chart's names: statistic and method (the coefficient)
#          or fit_statistic and fit (the fitted line), x and y (each a variable
#          as the settings write one: list(measure =, value =, visit =), without
#          `visit` for a baseline value, or list(col =)), baseline_visits,
#          baseline_stat, color_by, panel_by, panel, filters (a named list of
#          column to values), x_scale, y_scale
#
# A member of the identity that is not set is left out, never written as null.
# A member that is a list of values is an unnamed list, so it is written as a
# JSON array whatever its length. Text is sorted by code point
# (`method = "radix"`), which is the order the chart sorts in.
association_scatter_id <- function(dfRows, lView) {
  lDataId <- list(chart = "association-scatter", x = lView$x, y = lView$y)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(lView$baseline_visits)
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$color_by)) {
    lDataId$color_by <- lView$color_by
    lDataId$groups <- as.list(sort(unique(as.character(dfRows$color)), method = "radix"))
  }
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- lView$panel
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(as.character(xValues)), method = "radix"))
    })
  }
  if (identical(lView$x_scale, "log")) lDataId$x_scale <- "log"
  if (identical(lView$y_scale, "log")) lDataId$y_scale <- "log"
  lDataId
}

# The coefficient: Pearson's or Spearman's, and within each colour when the view
# has one.
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

# The fitted line: the linear fit or the smooth of y on x, of every point of the
# panel, and within each colour when the view has one.
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

# ---- Reading the cases ---------------------------------------------------------

read_text <- function(file) {
  utils::read.csv(file.path(fixture, file), colClasses = "character", na.strings = "",
                  stringsAsFactors = FALSE, check.names = FALSE)
}

# The rows as the chart hands them to R: on a logarithmic axis, the base-10
# logarithm of the value.
read_rows <- function(file, lView) {
  rows <- read_text(file)
  rows$x <- as.numeric(rows$x)
  rows$y <- as.numeric(rows$y)
  if (identical(lView$x_scale, "log")) rows$x <- log10(rows$x)
  if (identical(lView$y_scale, "log")) rows$y <- log10(rows$y)
  rows
}

one <- function(x) if (is.na(x)) NULL else x
several <- function(x) if (is.na(x)) NULL else strsplit(x, "|", fixed = TRUE)[[1]]

# "SEX=F;RESPONSE=Responder|Non-responder" as a named list of column to values.
read_filters <- function(x) {
  if (is.na(x)) return(list())
  parts <- strsplit(strsplit(x, ";", fixed = TRUE)[[1]], "=", fixed = TRUE)
  stats::setNames(lapply(parts, function(part) several(part[[2]])), vapply(parts, `[[`, "", 1))
}

# An axis as the settings write a variable.
read_axis <- function(case, axis) {
  cell <- function(member) case[[paste0(axis, "_", member)]]
  if (!is.na(cell("col"))) return(list(col = cell("col")))
  variable <- list(measure = cell("measure"), value = cell("value"))
  if (!is.na(cell("visit"))) variable$visit <- cell("visit")
  variable
}

read_view <- function(case) {
  fit <- identical(case$kind, "fit")
  list(
    statistic = if (fit) NULL else case$statistic, method = if (fit) NULL else case$method,
    fit_statistic = if (fit) case$statistic else NULL, fit = if (fit) case$method else NULL,
    x = read_axis(case, "x"), y = read_axis(case, "y"),
    baseline_visits = several(case$baseline_visits), baseline_stat = case$baseline_stat,
    color_by = one(case$color_by), panel_by = one(case$panel_by), panel = one(case$panel),
    filters = read_filters(case$filters), x_scale = case$x_scale, y_scale = case$y_scale
  )
}

# ---- The results -----------------------------------------------------------------

cases <- read_text("cases.csv")
results <- lapply(seq_len(nrow(cases)), function(i) {
  case <- as.list(cases[i, ])
  view <- read_view(case)
  rows <- read_rows(case$file, view)
  key <- if (identical(case$kind, "fit")) {
    association_scatter_fit_key(rows, view)
  } else {
    association_scatter_key(rows, view)
  }
  c(
    list(case = case$case, file = case$file),
    key,
    list(value = do.call(key$name, c(list(rows), key$args)))
  )
})

# Which statistics file answered: the commit and the checksum its record gives.
record <- paste(readLines(file.path(vendored, "SOURCE.json"), warn = FALSE), collapse = "\n")
recorded <- function(member) {
  sub(sprintf('.*"%s": "([^"]*)".*', member), "\\1", record)
}

made_by <- list(
  script = "tools/r-association-statistics.R",
  r_version = paste(R.version$major, R.version$minor, sep = "."),
  platform = R.version$platform,
  statistics_file = file.path(vendored, "statistics.R"),
  statistics_commit = recorded("commit"),
  statistics_sha256 = recorded("sha256")
)

# One member per line at the top two levels, so a change to one result is a
# one-line change in review.
lines <- c(
  "{",
  paste0("  \"made_by\": ", to_json(made_by), ","),
  "  \"results\": [",
  paste0("    ", vapply(results, to_json, character(1)), c(rep(",", length(results) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s: %d results from gsm.bio's statistics at %s\n", out,
            made_by$r_version, length(results), substr(made_by$statistics_commit, 1, 7)))
