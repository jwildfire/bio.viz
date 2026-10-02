#!/usr/bin/env Rscript
# Writes the expected results for the group comparison chart's statistics line:
# what desktop R answers when it runs gsm.bio's statistics file, as vendored in
# site/vendor/gsm.bio/statistics.R, on the rows the chart hands R.
#
#   Rscript tools/r-group-statistics.R                 writes tests/fixtures/group-statistics-r.json
#   Rscript tools/r-group-statistics.R <output file>   writes somewhere else (the check
#                                                      in scripts/check-r-fixtures.mjs)
#
# The rows are not worked out here. Each case in tests/fixtures/group-statistics/
# is one panel of the gallery's demo chart, and its CSV file holds the rows the
# chart's own code made for that panel (tools/derive-group-statistics.mjs). This
# script reads them, calls the function the chart calls with the arguments the
# chart sends, and writes each answer as a stored result: the function's name,
# its arguments, the identity of the rows, the number of rows and what R
# returned.
#
# The name, the arguments and the identity are written by `group_comparison_key`
# below from what an R user knows of a view: the settings, by the chart's own
# names. That function is the recipe in docs/group-comparison.md, and the unit
# tests hold what it writes to what the chart asks, so a stored result written
# this way is found by the chart.
#
# The file records the R version that made it and the commit and checksum of the
# statistics file it sourced. The numbers in it are never typed in: rerun this
# script to change them.
#
# Base R and the stats package only: Analyze_GroupDifference needs nothing else.
# The JSON is written by hand below, following the rules by which bio.viz's
# connection turns an R value into JavaScript (docs/r-connection.md), so that
# the file holds each value in exactly the shape R in the browser returns it.
# Numbers are written with 17 significant digits, which is enough to read back
# the identical double.

args <- commandArgs(trailingOnly = TRUE)
fixture <- "tests/fixtures/group-statistics"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/group-statistics-r.json"

source(file.path(vendored, "statistics.R"))

# ---- The recipe: the key of one panel's stored result ------------------------
#
# dfRows   the panel's rows, one per participant: the id, `y`, `x`, and `color`
#          and `panel` when the view has them
# lView    the view, by the chart's names: statistic, test, pairwise, measure,
#          value_type, visit, baseline_visits, baseline_stat, group_by, color_by,
#          panel_by, panel, filters (a named list of column to values), y_scale
#
# A member of the identity that is not set is left out, never written as null.
# A member that is a list is an unnamed list, so it is written as a JSON array
# whatever its length. Text is sorted by code point (`method = "radix"`), which
# is the order the chart sorts in.
group_comparison_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(as.character(dfRows$x)), method = "radix")
  lDataId <- list(chart = "group-comparison", measure = lView$measure, value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- lView$visit
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(lView$baseline_visits)
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (!is.null(lView$color_by)) lDataId$color_by <- lView$color_by
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- lView$panel
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(as.character(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  list(
    name = lView$statistic,
    args = list(
      strValueCol = "y",
      strGroupCol = "x",
      strMethod = lView$test,
      # Pairs exist only among more than two groups.
      bPairwise = isTRUE(lView$pairwise) && length(chrGroups) > 2
    ),
    dataId = lDataId,
    rows = nrow(dfRows)
  )
}

# ---- Reading the cases ---------------------------------------------------------

read_text <- function(file) {
  utils::read.csv(file.path(fixture, file), colClasses = "character", na.strings = "",
                  stringsAsFactors = FALSE, check.names = FALSE)
}

read_rows <- function(file) {
  rows <- read_text(file)
  rows$y <- as.numeric(rows$y)
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

read_view <- function(case) {
  list(
    statistic = case$statistic, test = case$test, pairwise = identical(case$pairwise, "TRUE"),
    measure = case$measure, value_type = case$value_type, visit = one(case$visit),
    baseline_visits = several(case$baseline_visits), baseline_stat = case$baseline_stat,
    group_by = one(case$group_by), color_by = one(case$color_by), panel_by = one(case$panel_by),
    panel = one(case$panel), filters = read_filters(case$filters), y_scale = case$y_scale
  )
}

# ---- Writing JSON ----------------------------------------------------------------
#
#   data frame                array of row objects
#   named list, named vector  object
#   unnamed list              array
#   unnamed vector, length 1  a single value
#   unnamed vector, otherwise array
#   NA, NULL                  null

quote_json <- function(x) {
  x <- gsub("\\", "\\\\", x, fixed = TRUE)
  x <- gsub("\"", "\\\"", x, fixed = TRUE)
  x <- gsub("\n", "\\n", x, fixed = TRUE)
  paste0("\"", x, "\"")
}

scalar_json <- function(x) {
  if (is.na(x)) return("null")
  if (is.character(x)) return(quote_json(x))
  if (is.logical(x)) return(if (x) "true" else "false")
  if (is.integer(x)) return(as.character(x))
  sprintf("%.17g", x)
}

object_json <- function(names, values) {
  paste0("{", paste0(quote_json(names), ":", values, collapse = ","), "}")
}

to_json <- function(x) {
  if (is.null(x)) return("null")
  if (is.data.frame(x)) {
    rows <- vapply(seq_len(nrow(x)), function(i) {
      object_json(names(x), vapply(x, function(column) to_json(column[[i]]), character(1)))
    }, character(1))
    return(paste0("[", paste(rows, collapse = ","), "]"))
  }
  if (is.factor(x)) x <- as.character(x)
  named <- !is.null(names(x)) && length(x) > 0 && all(nzchar(names(x)))
  if (is.list(x)) {
    values <- vapply(x, to_json, character(1))
    if (named) return(object_json(names(x), values))
    return(paste0("[", paste(values, collapse = ","), "]"))
  }
  values <- vapply(seq_along(x), function(i) scalar_json(x[[i]]), character(1))
  if (named) return(object_json(names(x), values))
  if (length(x) == 1) return(values)
  paste0("[", paste(values, collapse = ","), "]")
}

# ---- The results -----------------------------------------------------------------

cases <- read_text("cases.csv")
results <- lapply(seq_len(nrow(cases)), function(i) {
  case <- as.list(cases[i, ])
  rows <- read_rows(case$file)
  key <- group_comparison_key(rows, read_view(case))
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
  script = "tools/r-group-statistics.R",
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
