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
# The JSON is written by hand (tools/r-json.R), following the rules by which
# bio.viz's connection turns an R value into JavaScript (docs/r-connection.md),
# so that the file holds each value in exactly the shape R in the browser
# returns it. Numbers are written with 17 significant digits, which is enough to
# read back the identical double.

args <- commandArgs(trailingOnly = TRUE)
fixture <- "tests/fixtures/group-statistics"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/group-statistics-r.json"

source(file.path(vendored, "statistics.R"))

# The core's cut rule, as tools/r-cut.R holds it, for the recipe's cut cases.
# A label holds the sign \u2264, so R must run in a UTF-8 locale.
if (!l10n_info()[["UTF-8"]]) {
  for (locale in c("C.UTF-8", "en_US.UTF-8")) {
    if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", locale)))) break
  }
}
if (!l10n_info()[["UTF-8"]]) stop("tools/r-group-statistics.R needs a UTF-8 locale (C.UTF-8 or en_US.UTF-8)")
local({
  src <- readLines("tools/r-cut.R", encoding = "UTF-8")
  from <- grep("^CUT_PROBS <- ", src)
  to <- grep("^cut_groups <- function", src)
  to <- to + which(src[to:length(src)] == "}")[1] - 1
  eval(parse(text = src[from:to], encoding = "UTF-8"), envir = globalenv())
})

# ---- The recipe: the key of one panel's stored result ------------------------
#
# dfRows   the panel's rows, one per participant: the id, `y`, `x`, and `color`
#          and `panel` when the view has them. When the groups are a cut
#          variable's, `x` is the factor cut() made, its levels low to high
# lView    the view, by the chart's names: statistic, test, pairwise, measure,
#          value_type, visit, baseline_visits, baseline_stat, group_by, color_by,
#          panel_by, panel, filters (a named list of column to values), y_scale
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
# A member that is a list is an unnamed list, so it is written as a JSON array
# whatever its length. Text is sorted by code point (`method = "radix"`), which
# is the order the chart sorts in. A cut's groups are handed to R low to high,
# the order of the levels cut() made, so R names them in that order; a column's
# are left to R, which sorts them by code point.
group_comparison_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(chart_text(dfRows$x)), method = "radix")
  lDataId <- list(chart = "group-comparison", measure = chart_text(lView$measure), value_type = lView$value_type)
  if (!is.null(lView$visit)) lDataId$visit <- chart_text(lView$visit)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (!is.null(lView$color_by)) lDataId$color_by <- lView$color_by
  if (!is.null(lView$panel_by)) {
    lDataId$panel_by <- lView$panel_by
    lDataId$panel <- chart_text(lView$panel)
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  # Unscheduled visits are drawn, and the results have some.
  if (isTRUE(lView$unscheduled_visits)) lDataId$unscheduled_visits <- TRUE
  lArgs <- list(
    strValueCol = "y",
    strGroupCol = "x",
    strMethod = lView$test,
    # Pairs exist only among more than two groups.
    bPairwise = isTRUE(lView$pairwise) && length(chrGroups) > 2
  )
  if (is.list(lView$group_by)) {
    if (!is.factor(dfRows$x)) stop("the groups of a cut variable must be the factor cut() made")
    lArgs$chrGroups <- as.list(levels(droplevels(dfRows$x)))
  }
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfRows))
}

# ---- The recipe: the key of the stored result for one biomarker over time -----
#
# The picture of one biomarker across its visits asks R once, for the test at
# every visit (bio.viz#85).
#
# dfRows   the rows of every visit tested, one per participant and visit: the
#          id, `y`, `x` and `visit`, each the row of that visit's own panel.
#          The visits are in visit order. When the groups are a cut variable's,
#          `x` is the factor cut() made, its levels low to high
# lView    the view, by the chart's names: statistic_by_visit, test,
#          visit_adjustment, measure, value_type, visits (the visits tested, in
#          visit order: every visit the biomarker has values at, without the
#          baseline visit when the value is a change, a fold change or a
#          percent change from one baseline visit), baseline_visits,
#          baseline_stat, group_by, filters, y_scale, unscheduled_visits
#
# The picture takes no second grouping and no panels, so the identity has no
# `color_by`, `panel_by` or `panel`. In place of one panel's `visit` it has
# `visits`, the visits tested. The arguments name the column of visits, the
# visits in order, and the adjustment across them by p.adjust()'s name for it,
# "none" when there is none. As for one panel, a column's groups are left to R
# and a cut's are handed over low to high.
group_comparison_by_visit_key <- function(dfRows, lView) {
  chrGroups <- sort(unique(chart_text(dfRows$x)), method = "radix")
  chrVisits <- chart_text(lView$visits)
  lDataId <- list(chart = "group-comparison", measure = chart_text(lView$measure), value_type = lView$value_type)
  lDataId$visits <- as.list(chrVisits)
  if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
  lDataId$baseline_stat <- lView$baseline_stat
  if (!is.null(lView$group_by)) lDataId$group_by <- lView$group_by
  lDataId$groups <- as.list(chrGroups)
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  if (identical(lView$y_scale, "log")) lDataId$positive_only <- TRUE
  if (isTRUE(lView$unscheduled_visits)) lDataId$unscheduled_visits <- TRUE
  lArgs <- list(
    strValueCol = "y",
    strGroupCol = "x",
    strByCol = "visit",
    strMethod = lView$test,
    chrBy = as.list(chrVisits),
    strPAdjust = lView$visit_adjustment
  )
  if (is.list(lView$group_by)) {
    if (!is.factor(dfRows$x)) stop("the groups of a cut variable must be the factor cut() made")
    lArgs$chrGroups <- as.list(levels(droplevels(dfRows$x)))
  }
  list(name = lView$statistic_by_visit, args = lArgs, dataId = lDataId, rows = nrow(dfRows))
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
# The writer is shared with the other charts' scripts: tools/r-json.R.

source("tools/r-json.R")

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

# One biomarker over time: one request for the whole row of visits. Beside what
# R answered, `separately` holds what R gives when each visit is asked alone
# and the p-values are then adjusted by p.adjust(): what each row of the answer
# is held to.
read_view_by_visit <- function(case) {
  list(
    statistic_by_visit = case$statistic_by_visit, test = case$test,
    visit_adjustment = case$visit_adjustment, measure = case$measure,
    value_type = case$value_type, visits = several(case$visits),
    baseline_visits = several(case$baseline_visits), baseline_stat = case$baseline_stat,
    group_by = one(case$group_by), filters = read_filters(case$filters), y_scale = case$y_scale
  )
}
over_time_cases <- read_text("over-time-cases.csv")
over_time <- lapply(seq_len(nrow(over_time_cases)), function(i) {
  case <- as.list(over_time_cases[i, ])
  rows <- read_rows(case$file)
  view <- read_view_by_visit(case)
  key <- group_comparison_by_visit_key(rows, view)
  chrGroups <- sort(unique(rows$x), method = "radix")
  alone <- vapply(view$visits, function(visit) {
    answer <- Analyze_GroupDifference(rows[rows$visit == visit, ], "y", "x", strMethod = view$test,
                                      chrGroups = chrGroups, bPairwise = FALSE)
    if (identical(answer$status, "ok")) answer$p_value else NA_real_
  }, numeric(1), USE.NAMES = FALSE)
  adjusted <- alone
  adjusted[!is.na(alone)] <- stats::p.adjust(alone[!is.na(alone)], method = view$visit_adjustment)
  c(
    list(case = case$case, file = case$file),
    key,
    list(
      value = do.call(key$name, c(list(rows), lapply(key$args, unlist))),
      separately = list(visits = as.list(view$visits), p_unadjusted = as.list(alone),
                        p_value = as.list(adjusted))
    )
  )
})

# A cut case: the rows of the panel of IL-6's change from Baseline to Week 4 by
# CRP at Baseline cut, every participant with both values, in the participant
# table's order, the groups the factor cut() made. The cut points are worked out
# on every participant with a CRP value. Typed points are a list, as the
# settings write them.
study <- "site/data/synthetic-study"
study_results <- utils::read.csv(file.path(study, "synthetic_results.csv"), stringsAsFactors = FALSE)
study_people <- utils::read.csv(file.path(study, "synthetic_participants.csv"), stringsAsFactors = FALSE)
result_at <- function(measure, visit) {
  rows <- study_results[study_results$TEST == measure & study_results$VISIT == visit, ]
  rows$STRESN[match(study_people$USUBJID, rows$USUBJID)]
}
cut_case <- function(name, cut, test) {
  y <- result_at("IL-6", "Week 4") - result_at("IL-6", "Baseline")
  crp <- result_at("CRP", "Baseline")
  made <- cut_points(crp, if (is.list(cut)) unlist(cut) else cut)
  x <- factor(cut_groups(crp, made$points), levels = cut_labels(made$points))
  keep <- !is.na(y) & !is.na(x)
  rows <- data.frame(USUBJID = study_people$USUBJID[keep], y = y[keep], x = x[keep],
                     stringsAsFactors = FALSE)
  view <- list(
    statistic = "Analyze_GroupDifference", test = test, pairwise = FALSE, measure = "IL-6",
    value_type = "change", visit = "Week 4", baseline_visits = "Baseline", baseline_stat = "mean",
    group_by = list(measure = "CRP", visit = "Baseline", value = "raw", cut = cut),
    filters = list(), y_scale = "linear"
  )
  key <- group_comparison_key(rows, view)
  c(
    list(case = name, ids = as.list(rows$USUBJID), groups = as.list(as.character(rows$x))),
    key,
    list(value = do.call(key$name, c(list(rows), key$args)))
  )
}

# The recipe on a data frame as R holds one: the rows of the panel for F, with
# the panel column a number, 2, as a cohort number is in a data frame. The chart
# names the panel as text, so the key the recipe writes must too.
recipes <- local({
  case <- as.list(cases[cases$case == "welch-panel-women", ])
  rows <- read_rows(case$file)
  rows$panel <- 2
  view <- read_view(case)
  view$panel_by <- "COHORT"
  view$panel <- unique(rows$panel)
  key <- group_comparison_key(rows, view)
  # And chart_text() itself, on values a data frame may hold, each beside the
  # text it writes, which the unit tests hold to the chart's String().
  values <- list(2, 4, 100, -0.5, 0.1 + 0.2, 1 / 3, 1e-6, 1.5e-6, 0.000001234, 1e-7, 1e20,
                 1e21, 2^53 + 2, TRUE, FALSE)
  list(
    c(
      list(case = "numeric-panel", file = case$file),
      key,
      list(value = do.call(key$name, c(list(rows), key$args)))
    ),
    list(case = "chart-text", values = values, text = lapply(values, chart_text)),
    # IL-6's change to Week 4 by CRP at Baseline cut, worked out here from the
    # vendored study by the core's cut rule: at the median, and at 10, which
    # leaves a group below R's minimum size.
    cut_case("cut-median", "median", "t"),
    cut_case("cut-too-small", list(10), "t"),
    # A view with unscheduled visits drawn (#84): the identity says so, and is
    # otherwise the one the same rows have without them.
    local({
      case <- as.list(cases[cases$case == "welch", ])
      rows <- read_rows(case$file)
      view <- read_view(case)
      view$unscheduled_visits <- TRUE
      key <- group_comparison_key(rows, view)
      c(
        list(case = "unscheduled-visits", file = case$file),
        key,
        list(value = do.call(key$name, c(list(rows), key$args)))
      )
    }),
    # The edge of the claim: numbers of 13 significant digits, the most for
    # which R's reading of a number is exact enough to find the fewest digits;
    # and NaN, which JSON cannot hold as a value but the chart writes "NaN".
    local({
      digits13 <- list(0.1234567890123, 9876543.210987, 1.000000000001, -45.67890123456,
                       3.141592653590, 2.718281828459e-5, 6.022140760000e23)
      list(case = "chart-text-edge", values = digits13, text = lapply(digits13, chart_text),
           nan = chart_text(NaN))
    })
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
  "  ],",
  "  \"recipes\": [",
  paste0("    ", vapply(recipes, to_json, character(1)), c(rep(",", length(recipes) - 1), "")),
  "  ],",
  "  \"over_time\": [",
  paste0("    ", vapply(over_time, to_json, character(1)), c(rep(",", length(over_time) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s: %d results from gsm.bio's statistics at %s\n", out,
            made_by$r_version, length(results) + length(over_time), substr(made_by$statistics_commit, 1, 7)))
