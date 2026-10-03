#!/usr/bin/env Rscript
# Writes the expected results for the correlation matrix: what desktop R answers
# when it runs gsm.bio's statistics file, as vendored in
# site/vendor/gsm.bio/statistics.R, on the frames the chart hands R.
#
#   Rscript tools/r-matrix-statistics.R                 writes tests/fixtures/matrix-statistics-r.json
#   Rscript tools/r-matrix-statistics.R <output file>   writes somewhere else (the check
#                                                       in scripts/check-r-fixtures.mjs)
#
# The frames are not worked out here. Each case in tests/fixtures/matrix-statistics/
# is the gallery's demo chart in one view, and its CSV file holds the frame the
# chart's own code made for that view (tools/derive-matrix-statistics.mjs): one
# row per participant, the id and one column per variable of the grid, empty
# where the participant has no value. This script reads them, calls the function
# the chart calls with the arguments the chart sends, and writes each answer as
# a stored result: the function's name, its arguments, the identity of the
# frame, the number of rows and what R returned. Which participants a pair has
# in common is counted by R, in the function.
#
# The name, the arguments and the identity are written by
# `correlation_matrix_key` below from what an R user knows of a view: the
# settings, by the chart's own names. That function is the recipe in
# docs/correlation-matrix.md, and the unit tests hold what it writes to what the
# chart asks, so a stored result written this way is found by the chart.
#
# The file records the R version that made it and the commit and checksum of the
# statistics file it sourced. The numbers in it are never typed in: rerun this
# script to change them.
#
# Base R and the stats package only: Analyze_CorrelationMatrix needs nothing
# else. The JSON is written by hand (tools/r-json.R).

args <- commandArgs(trailingOnly = TRUE)
fixture <- "tests/fixtures/matrix-statistics"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/matrix-statistics-r.json"

source(file.path(vendored, "statistics.R"))
source("tools/r-json.R")

# ---- The recipe: the key of one grid's stored result --------------------------
#
# dfFrame  the frame, one row per participant: the id, and one numeric column
#          per variable of the grid, named v1, v2, … in the grid's order, NA
#          where the participant has no value
# lView    the view, by the chart's names: statistic, method, min_pairs (NULL
#          for R's own minimum), variables (an unnamed list, one per column of
#          the grid in order, each a variable as the settings write one:
#          list(measure =, value =, visit =), without `visit` for a baseline
#          value), baseline_visits, baseline_stat, filters (a named list of
#          column to values)
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
correlation_matrix_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "correlation-matrix", variables = lapply(unname(lView$variables), function(variable) lapply(variable, chart_text)))
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  lArgs <- list(
    chrCols = as.list(paste0("v", seq_along(lView$variables))),
    strMethod = lView$method
  )
  # The minimum is sent only when the reader set one; otherwise it is R's own.
  if (!is.null(lView$min_pairs)) lArgs$nMinPairs <- lView$min_pairs
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfFrame))
}

# ---- Reading the cases ---------------------------------------------------------

read_text <- function(file) {
  utils::read.csv(file.path(fixture, file), colClasses = "character", na.strings = "",
                  stringsAsFactors = FALSE, check.names = FALSE)
}

# The frame, with every variable's column a number and a gap as NA.
read_frame <- function(file) {
  rows <- read_text(file)
  for (column in names(rows)[-1]) rows[[column]] <- as.numeric(rows[[column]])
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

# The grid's variables as the settings write them. Across biomarkers they are
# the biomarkers at one visit; across visits, one biomarker at the visits.
read_variables <- function(case) {
  labels <- several(case$variables)
  lapply(labels, function(label) {
    if (identical(case$mode, "visits")) {
      list(measure = case$measure, value = case$value_type, visit = label)
    } else if (identical(case$value_type, "baseline")) {
      list(measure = label, value = case$value_type)
    } else {
      list(measure = label, value = case$value_type, visit = case$visit)
    }
  })
}

read_view <- function(case) {
  list(
    statistic = case$statistic, method = case$method,
    min_pairs = if (is.na(case$min_pairs)) NULL else as.numeric(case$min_pairs),
    variables = read_variables(case),
    baseline_visits = several(case$baseline_visits), baseline_stat = case$baseline_stat,
    filters = read_filters(case$filters)
  )
}

# ---- The results -----------------------------------------------------------------

cases <- read_text("cases.csv")
results <- lapply(seq_len(nrow(cases)), function(i) {
  case <- as.list(cases[i, ])
  frame <- read_frame(case$file)
  key <- correlation_matrix_key(frame, read_view(case))
  c(
    list(case = case$case, file = case$file),
    key,
    list(value = do.call(key$name, c(list(frame), key$args)))
  )
})

# Which statistics file answered: the commit and the checksum its record gives.
# The recipe on a data frame as R holds one: the first case's grid with its
# first variable read at a visit written as a number, 4, as a visit number is
# in a data frame. The chart names a visit as text, so the key must too.
recipes <- local({
  case <- as.list(cases[1, ])
  view <- read_view(case)
  view$variables[[1]]$visit <- 4
  list(c(list(case = "numeric-visit", file = case$file),
         correlation_matrix_key(read_frame(case$file), view)))
})

record <- paste(readLines(file.path(vendored, "SOURCE.json"), warn = FALSE), collapse = "\n")
recorded <- function(member) {
  sub(sprintf('.*"%s": "([^"]*)".*', member), "\\1", record)
}

made_by <- list(
  script = "tools/r-matrix-statistics.R",
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
