#!/usr/bin/env Rscript
# Writes the expected results for the biomarker screen: what desktop R answers
# when it runs gsm.bio's statistics file, as vendored in
# site/vendor/gsm.bio/statistics.R, on the frames the chart hands R.
#
#   Rscript tools/r-screen-statistics.R                 writes tests/fixtures/screen-statistics-r.json
#   Rscript tools/r-screen-statistics.R <output file>   writes somewhere else (the check
#                                                       in scripts/check-r-fixtures.mjs)
#
# The frames are not worked out here. Each case in tests/fixtures/screen-statistics/
# is the gallery's demo chart in one view, and its CSV file holds the frame the
# chart's own code made for that view (tools/derive-screen-statistics.mjs): one
# row per participant, the id, one column per biomarker, and the column of
# groups or the variable correlated with, empty where the participant has no
# value. This script reads them, calls the function the chart calls with the
# arguments the chart sends, and writes each answer as a stored result: the
# function's name, its arguments, the identity of the frame, the number of rows
# and what R returned. Who each row has is counted by R, in the function.
#
# The name, the arguments and the identity are written by `biomarker_screen_key`
# below from what an R user knows of a view: the settings, by the chart's own
# names. That function is the recipe in docs/biomarker-screen.md, and the unit
# tests hold what it writes to what the chart asks, so a stored result written
# this way is found by the chart.
#
# The file records the R version that made it and the commit and checksum of the
# statistics file it sourced. The numbers in it are never typed in: rerun this
# script to change them.
#
# Base R and the stats package only: Analyze_Screen's difference and correlation
# rows need nothing else. The JSON is written by hand (tools/r-json.R).

args <- commandArgs(trailingOnly = TRUE)
fixture <- "tests/fixtures/screen-statistics"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/screen-statistics-r.json"

source(file.path(vendored, "statistics.R"))
source("tools/r-json.R")

# ---- The recipe: the key of one screen's stored result ------------------------
#
# dfFrame  the frame, one row per participant: the id, one numeric column per
#          biomarker of the screen, named by the biomarker, NA where the
#          participant has no value; and the column of groups, named by its
#          column, or the variable correlated with, named by with_name
# lView    the view, by the chart's names: statistic, comparison
#          ("difference" or "correlation"), value_type, visit (NULL for a
#          baseline value), biomarkers (the rows, in order), group_by and groups
#          (the two, first and second) for a difference, with (the variable as
#          the settings write one: list(measure =, value =, visit =) or
#          list(col =)) and with_name (its column in the frame) and method for a
#          correlation, adjustment ("BH" or "holm"), baseline_visits,
#          baseline_stat, filters (a named list of column to values)
#
# A member of the identity that is not set is left out, never written as null.
# A member that is a list of values is an unnamed list, so it is written as a
# JSON array whatever its length. Text is sorted by code point
# (`method = "radix"`), which is the order the chart sorts in.
# A value as the chart writes it into the identity: as text. A number is
# written as the chart writes one, in full and with no exponent, one value at a
# time, so a visit column holding the number 4 is written "4".
chart_text <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.numeric(x)) {
    return(vapply(x, function(value) format(value, scientific = FALSE, trim = TRUE, digits = 15),
                  character(1)))
  }
  as.character(x)
}

biomarker_screen_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "biomarker-screen", value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- chart_text(lView$visit)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (identical(lView$comparison, "correlation")) lDataId$with <- lapply(lView$with, chart_text)
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  lArgs <- list(chrCols = as.list(chart_text(lView$biomarkers)), strComparison = lView$comparison)
  if (identical(lView$comparison, "difference")) {
    lArgs$strGroupCol <- lView$group_by
    lArgs$chrGroups <- as.list(chart_text(lView$groups))
  } else {
    lArgs$strWithCol <- lView$with_name
    lArgs$strCorMethod <- lView$method
  }
  lArgs$strPAdjust <- lView$adjustment
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfFrame))
}

# ---- Reading the cases ---------------------------------------------------------

read_text <- function(file) {
  utils::read.csv(file.path(fixture, file), colClasses = "character", na.strings = "",
                  stringsAsFactors = FALSE, check.names = FALSE)
}

one <- function(x) if (is.na(x)) NULL else x
several <- function(x) if (is.na(x)) NULL else strsplit(x, "|", fixed = TRUE)[[1]]

# "SEX=F;RESPONSE=Responder|Non-responder" as a named list of column to values.
read_filters <- function(x) {
  if (is.na(x)) return(list())
  parts <- strsplit(strsplit(x, ";", fixed = TRUE)[[1]], "=", fixed = TRUE)
  stats::setNames(lapply(parts, function(part) several(part[[2]])), vapply(parts, `[[`, "", 1))
}

# The variable correlated with, as the settings write one.
read_with <- function(case) {
  if (!is.na(case$with_col)) return(list(col = case$with_col))
  lWith <- list(measure = case$with_measure, value = case$with_value)
  if (!identical(case$with_value, "baseline")) lWith$visit <- case$with_visit
  lWith
}

read_view <- function(case) {
  lView <- list(
    statistic = case$statistic, comparison = case$comparison, value_type = case$value_type,
    visit = one(case$visit), biomarkers = several(case$biomarkers),
    adjustment = case$adjustment, baseline_visits = several(case$baseline_visits),
    baseline_stat = case$baseline_stat, filters = read_filters(case$filters)
  )
  if (identical(case$comparison, "difference")) {
    lView$group_by <- case$group_by
    lView$groups <- several(case$groups)
  } else {
    lView$with <- read_with(case)
    lView$with_name <- case$with_name
    lView$method <- case$method
  }
  lView
}

# The frame, with every biomarker's column a number and a gap as NA; the column
# of groups stays text, and the variable correlated with is a number.
read_frame <- function(case) {
  rows <- read_text(case$file)
  lView <- read_view(case)
  numeric <- c(lView$biomarkers, if (identical(case$comparison, "correlation")) lView$with_name)
  for (column in numeric) rows[[column]] <- as.numeric(rows[[column]])
  rows
}

# ---- The results -----------------------------------------------------------------

cases <- read_text("cases.csv")
results <- lapply(seq_len(nrow(cases)), function(i) {
  case <- as.list(cases[i, ])
  frame <- read_frame(case)
  key <- biomarker_screen_key(frame, read_view(case))
  c(
    list(case = case$case, file = case$file),
    key,
    list(value = do.call(key$name, c(list(frame), key$args)))
  )
})

# Which statistics file answered: the commit and the checksum its record gives.
record <- paste(readLines(file.path(vendored, "SOURCE.json"), warn = FALSE), collapse = "\n")
recorded <- function(member) {
  sub(sprintf('.*"%s": "([^"]*)".*', member), "\\1", record)
}

made_by <- list(
  script = "tools/r-screen-statistics.R",
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
