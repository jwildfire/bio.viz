#!/usr/bin/env Rscript
# Writes what desktop R says about the survival curves the stratified survival
# chart draws on the synthetic study: for each case the participants in it,
# each with their group, time and event; each group's Kaplan-Meier estimate as
# survival::survfit() gives it; and what gsm.bio's Analyze_Survival, as
# vendored in site/vendor/gsm.bio/statistics.R, answers for the groups, with
# the key a stored result is found by.
#
#   Rscript tools/r-survival.R                 writes tests/fixtures/stratified-survival-r.json
#   Rscript tools/r-survival.R <output file>   writes somewhere else (the check
#                                              in scripts/check-r-fixtures.mjs)
#
# The chart's curves (safety.viz's kit, kmEstimate), its groups and what it
# asks R (src/stratified-survival/) are held to this file by the unit tests and
# the browser tests named SS-*. The numbers in it are never typed in: rerun this
# script to change them.
#
# Nothing of bio.viz is used: the tables are read from the vendored CSV files,
# a biomarker as tools/r-cross-tab.R reads one, and a cut is the core's recipe,
# read from tools/r-cut.R, which holds the docs' copy of it. Base R, and the
# survival package, which Analyze_Survival calls.
#
# The JSON is written by hand (tools/r-json.R). Numbers with 17 significant
# digits, enough to read back the identical double.

# A label holds the sign ≤, so R must run in a UTF-8 locale.
if (!l10n_info()[["UTF-8"]]) {
  for (locale in c("C.UTF-8", "en_US.UTF-8")) {
    if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", locale)))) break
  }
}
if (!l10n_info()[["UTF-8"]]) stop("tools/r-survival.R needs a UTF-8 locale (C.UTF-8 or en_US.UTF-8)")

args <- commandArgs(trailingOnly = TRUE)
study <- "site/data/synthetic-study"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/stratified-survival-r.json"

source(file.path(vendored, "statistics.R"))
source("tools/r-json.R")

# The core's cut rule, as tools/r-cut.R holds it.
local({
  src <- readLines("tools/r-cut.R", encoding = "UTF-8")
  from <- grep("^CUT_PROBS <- ", src)
  to <- grep("^cut_groups <- function", src)
  to <- to + which(src[to:length(src)] == "}")[1] - 1
  eval(parse(text = src[from:to], encoding = "UTF-8"), envir = globalenv())
})

study_results <- utils::read.csv(file.path(study, "synthetic_results.csv"), stringsAsFactors = FALSE)
study_people <- utils::read.csv(file.path(study, "synthetic_participants.csv"), stringsAsFactors = FALSE)
study_outcomes <- utils::read.csv(file.path(study, "synthetic_outcomes.csv"), stringsAsFactors = FALSE)

# ---- The recipe: the key of one view's stored result ----------------------------
#
# dfRows   the view's rows, one per participant with a group and an outcome: the
#          id, `time`, `group` (the participant's group as text: a column's
#          value, or a cut variable's label) and the flag, `censor` (1 =
#          censored, as ADaM's CNSR) or `event` (1 = event), whichever the
#          outcomes table holds
# lView    the view, by the chart's names: statistic, endpoint, group_by (a
#          column's name, or a cut variable as the settings write one:
#          list(measure =, visit =, value =, cut =), without visit for a
#          baseline value, or list(col =, type = "number", cut =), typed points
#          as a list), groups (the groups low to high for a cut, as cut() made
#          them), baseline_visits, baseline_stat, filters (a named list of
#          column to values)
#
# A member of the identity that is not set is left out, never written as null.
# A list of values is an unnamed list, so it is written as a JSON array
# whatever its length. Text is sorted by code point (`method = "radix"`), which
# is the order the chart sorts in. A cut's groups are handed to R low to high, a
# column's by code point. The baseline settings are named only when a cut
# biomarker reads a baseline: its value is a baseline, or a change from one.
reads_baseline <- function(variable) {
  is.list(variable) && !is.null(variable$measure) && !identical(variable$value, "raw")
}

chart_variable <- function(variable) {
  if (is.character(variable)) return(variable)
  lapply(variable, function(member) if (is.numeric(member)) as.list(member) else member)
}

survival_key <- function(dfRows, lView) {
  lDataId <- list(chart = "stratified-survival", endpoint = lView$endpoint, group_by = chart_variable(lView$group_by))
  if (reads_baseline(lView$group_by)) {
    if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(lView$baseline_visits)
    lDataId$baseline_stat <- lView$baseline_stat
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(as.character(xValues)), method = "radix"))
    })
  }
  chrGroups <- if (is.list(lView$group_by)) lView$groups else sort(unique(dfRows$group), method = "radix")
  lArgs <- list(strTimeCol = "time", strGroupCol = "group")
  if ("censor" %in% names(dfRows)) lArgs$strCensorCol <- "censor" else lArgs$strEventCol <- "event"
  lArgs$chrGroups <- as.list(chrGroups)
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfRows))
}

# ---- The tables ------------------------------------------------------------------

# Whether a value is missing as the chart reads it: NA, empty, or white space
# alone, the white space being what JavaScript's String.prototype.trim()
# removes (tools/r-cross-tab.R says why this class).
JS_SPACE <- "[\t-\r    -     　﻿]"
is_blank <- function(value) is.na(value) | trimws(value, whitespace = JS_SPACE) == ""

result_at <- function(results, people, measure, visit) {
  rows <- results[results$TEST == measure & results$VISIT == visit, ]
  rows$STRESN[match(people$USUBJID, rows$USUBJID)]
}

# A participant's group: a column's value, or a cut biomarker's group, its
# points worked out on the participants kept who have a value of it.
group_of <- function(variable, keep, tables) {
  people <- tables$participants
  if (is.character(variable)) {
    value <- as.character(people[[variable]])
    value[is_blank(value)] <- NA
    return(list(values = value, levels = NULL, x = NULL, points = NULL))
  }
  x <- switch(variable$value,
    raw = result_at(tables$results, people, variable$measure, variable$visit),
    change = result_at(tables$results, people, variable$measure, variable$visit) -
      result_at(tables$results, people, variable$measure, "Baseline")
  )
  x[!keep] <- NA
  cut <- if (is.list(variable$cut)) unlist(variable$cut) else variable$cut
  made <- cut_points(x[keep], cut)
  list(values = cut_groups(x, made$points), levels = cut_labels(made$points), x = x,
       points = made$points)
}

# Each group's Kaplan-Meier estimate as survfit() gives it, at every time it
# records: an event, a censoring, or both.
curve_of <- function(time, event) {
  fit <- survival::survfit(survival::Surv(time, event) ~ 1)
  list(time = fit$time, n_risk = fit$n.risk, n_event = fit$n.event, n_censor = fit$n.censor,
       surv = fit$surv)
}

# A case: the view's rows for the participants the filters keep who have a
# group and an outcome, and R's answer. Each table is the study's unless a case
# brings its own, which is then written into the case under `tables`. `flag`
# names the outcomes table's flag column: "CNSR" (censored = 1) or "EVENT"
# (event = 1).
case <- function(name, group_by, filters = list(), tables = list(), flag = "CNSR",
                 endpoint = "EFS") {
  own <- tables
  tables <- list(results = study_results, participants = study_people, outcomes = study_outcomes)
  tables[names(own)] <- own
  people <- tables$participants
  keep <- rep(TRUE, nrow(people))
  for (column in names(filters)) keep <- keep & people[[column]] %in% filters[[column]]
  groups <- group_of(group_by, keep, tables)
  outcomes <- tables$outcomes[tables$outcomes$PARAMCD == endpoint, ]
  at <- match(people$USUBJID, outcomes$USUBJID)
  time <- outcomes$AVAL[at]
  flags <- outcomes[[flag]][at]
  event <- if (flag == "CNSR") flags == 0 else flags == 1
  used <- keep & !is.na(groups$values) & !is.na(time) & !is.na(flags) & time >= 0
  levels <- if (is.null(groups$levels)) sort(unique(groups$values[used]), method = "radix") else groups$levels
  levels <- levels[levels %in% groups$values[used]]
  rows <- data.frame(USUBJID = people$USUBJID[used], time = time[used], group = groups$values[used],
                     stringsAsFactors = FALSE)
  rows[[if (flag == "CNSR") "censor" else "event"]] <- as.numeric(flags[used])
  view <- list(
    statistic = "Analyze_Survival", endpoint = endpoint, group_by = group_by, groups = levels,
    baseline_visits = "Baseline", baseline_stat = "mean", filters = filters
  )
  key <- survival_key(rows, view)
  value <- do.call(key$name, c(list(rows), key$args))
  curves <- lapply(levels, function(level) {
    inside <- rows$group == level
    c(list(group = level), curve_of(rows$time[inside], event[used][inside]))
  })
  c(
    list(case = name, participants = sum(keep)),
    if (length(own)) list(tables = own) else NULL,
    list(
      ids = as.list(rows$USUBJID), group_of = as.list(rows$group), time_of = as.list(rows$time),
      event_of = as.list(event[used]), groups = as.list(levels),
      points = if (is.null(groups$points)) NULL else as.list(groups$points),
      n_values = if (is.null(groups$x)) NULL else sum(!is.na(groups$x)),
      curves = curves
    ),
    key,
    list(value = value)
  )
}

crp <- function(cut) list(measure = "CRP", visit = "Baseline", value = "raw", cut = cut)

# The study with its outcomes flagged the other way round: an event column,
# 1 for an event, in place of CNSR.
event_tables <- local({
  outcomes <- study_outcomes
  outcomes$EVENT <- 1L - outcomes$CNSR
  outcomes$CNSR <- NULL
  list(outcomes = outcomes)
})

# Two arms, one of which has no event: the hazard ratio is not estimable, and
# R says why. Made here, not drawn from the study, and written into the case.
no_event_tables <- local({
  i <- seq_len(24)
  people <- data.frame(USUBJID = sprintf("N-%02d", i), ARM = rep(c("Early", "Late"), each = 12),
                       stringsAsFactors = FALSE)
  list(
    participants = people,
    results = data.frame(USUBJID = people$USUBJID, VISIT = "Day 1", VISITNUM = 1, TEST = "X", STRESU = "u",
                         STRESN = 1, stringsAsFactors = FALSE),
    outcomes = data.frame(
      USUBJID = people$USUBJID, PARAMCD = "EFS", PARAM = "Event-free survival (months)",
      AVAL = c(seq(1, 12, length.out = 12), seq(2, 13, length.out = 12)),
      CNSR = c(rep(c(0L, 0L, 1L), 4), rep(1L, 12)), stringsAsFactors = FALSE
    )
  )
})

cases <- list(
  case("crp-median", crp("median")),
  # Where the demo's cut line is dropped in the tests: the point as its label
  # writes it.
  case("crp-at-4", crp(list(4))),
  case("crp-tertiles", crp("tertiles")),
  case("arm", "ARM"),
  case("crp-median-women", crp("median"), filters = list(SEX = "F")),
  # CRP cut at 10 leaves 4 participants above it: below R's minimum group size.
  case("crp-at-10", crp(list(10))),
  case("crp-median-event-flag", crp("median"), tables = event_tables, flag = "EVENT"),
  case("no-events-in-one-arm", "ARM", tables = no_event_tables)
)

record <- paste(readLines(file.path(vendored, "SOURCE.json"), warn = FALSE), collapse = "\n")
recorded <- function(member) sub(sprintf('.*"%s": "([^"]*)".*', member), "\\1", record)
made_by <- list(
  script = "tools/r-survival.R",
  r_version = paste(R.version$major, R.version$minor, sep = "."),
  survival_version = as.character(utils::packageVersion("survival")),
  platform = R.version$platform,
  statistics_file = file.path(vendored, "statistics.R"),
  statistics_commit = recorded("commit"),
  statistics_sha256 = recorded("sha256")
)

# Text is written in ASCII: the sign ≤ of a cut's label as its JSON escape.
ascii <- function(text) gsub("≤", "\\u2264", text, fixed = TRUE)
lines <- c(
  "{",
  paste0("  \"made_by\": ", to_json(made_by), ","),
  "  \"cases\": [",
  paste0("    ", vapply(cases, function(entry) ascii(to_json(entry)), character(1)),
         c(rep(",", length(cases) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s and survival %s: %d cases from gsm.bio's statistics at %s\n", out,
            made_by$r_version, made_by$survival_version, length(cases), substr(made_by$statistics_commit, 1, 7)))
