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
biomarker_screen_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "biomarker-screen", value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- chart_text(lView$visit)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (identical(lView$comparison, "correlation")) lDataId$with <- lapply(lView$with, chart_text)
  if (identical(lView$comparison, "hazard")) lDataId$endpoint <- chart_text(lView$endpoint)
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  lArgs <- list(chrCols = as.list(chart_text(lView$biomarkers)), strComparison = lView$comparison)
  if (identical(lView$comparison, "difference")) {
    lArgs$strGroupCol <- lView$group_by
    lArgs$chrGroups <- as.list(chart_text(lView$groups))
  } else if (identical(lView$comparison, "hazard")) {
    # Each biomarker is cut at its median by Analyze_Screen itself; the frame
    # holds the time and the flag, censored or event, as the table reads it.
    lArgs$strTimeCol <- "time"
    if (identical(lView$flag, "event")) lArgs$strEventCol <- "event" else lArgs$strCensorCol <- "censor"
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
  } else if (identical(case$comparison, "hazard")) {
    lView$endpoint <- case$endpoint
    lView$flag <- case$flag
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
  numeric <- c(
    lView$biomarkers,
    if (identical(case$comparison, "correlation")) lView$with_name,
    if (identical(case$comparison, "hazard")) c("time", lView$flag)
  )
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
# The recipe on a data frame as R holds one: the first case's screen at a
# visit written as a number, 4, as a visit number is in a data frame. The chart
# names a visit as text, so the key must too.
recipes <- local({
  case <- as.list(cases[1, ])
  view <- read_view(case)
  view$visit <- 4
  list(c(list(case = "numeric-visit", file = case$file), biomarker_screen_key(read_frame(case), view)))
})

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
  "  ],",
  "  \"recipes\": [",
  paste0("    ", vapply(recipes, to_json, character(1)), c(rep(",", length(recipes) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s: %d results from gsm.bio's statistics at %s\n", out,
            made_by$r_version, length(results), substr(made_by$statistics_commit, 1, 7)))
