#!/usr/bin/env Rscript
# Writes what desktop R says about the shared cut rule: for each case, the cut
# points stats::quantile() gives and the group base::cut() puts each
# participant in, with the label of each group.
#
#   Rscript tools/r-cut.R                 writes tests/fixtures/cut-r.json
#   Rscript tools/r-cut.R <output file>   writes somewhere else (the check in
#                                         scripts/check-r-fixtures.mjs)
#
# The core's cut rule (src/core/cut.js) is held to this file by the unit tests
# named CUT-*, and the group comparison chart's groups by the browser tests
# named GC-CUT-*. The numbers in it are never typed in: rerun this script to
# change them.
#
# Base R only, and nothing of bio.viz. The study cases read the vendored CSV
# files and work the value types out from the definitions in docs/core.md, as
# tools/r-group-comparison.R does. The edge cases are written here, so the
# values they are cut on are R's input, recorded beside R's answer.
#
# The rule, which is the recipe in docs/core.md:
#
#   x       the cut variable's value for each participant the filters keep, one
#           per participant, NA where there is none
#   asked   stats::quantile(x, probs, type = 7, na.rm = TRUE, names = FALSE),
#           probs 0.5 (median), c(1, 2) / 3 (tertiles) or c(1, 2, 3) / 4
#           (quartiles); typed points as written
#   points  unique(asked): a repeated point collapses
#   groups  cut(x, breaks = c(-Inf, points, Inf), right = TRUE,
#           labels = cut_labels(points)): a value equal to a cut point falls in
#           the lower group, and NA stays NA
#   labels  cut_labels(points), below: low to high, each with its bounds, a
#           bound written as format(signif(p, 4), scientific = FALSE,
#           trim = TRUE)
#
# Numbers are written with 17 significant digits, which is enough to read back
# the identical double.

# A label holds the sign \u2264, so R must run in a UTF-8 locale, which Rscript
# does not always start in.
if (!l10n_info()[["UTF-8"]]) {
  for (locale in c("C.UTF-8", "en_US.UTF-8")) {
    if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", locale)))) break
  }
}
if (!l10n_info()[["UTF-8"]]) stop("tools/r-cut.R needs a UTF-8 locale (C.UTF-8 or en_US.UTF-8)")

args <- commandArgs(trailingOnly = TRUE)
study <- "site/data/synthetic-study"
if (!file.exists(file.path(study, "synthetic_results.csv"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/cut-r.json"

results <- utils::read.csv(file.path(study, "synthetic_results.csv"), stringsAsFactors = FALSE)
participants <- utils::read.csv(file.path(study, "synthetic_participants.csv"), stringsAsFactors = FALSE)

# ---- The recipe ----------------------------------------------------------------

CUT_PROBS <- list(median = 0.5, tertiles = c(1, 2) / 3, quartiles = c(1, 2, 3) / 4)

cut_bound <- function(p) format(signif(p, 4), scientific = FALSE, trim = TRUE)

bound_labels <- function(points) {
  k <- length(points)
  if (k == 0) return(character(0))
  bounds <- vapply(points, cut_bound, character(1))
  middle <- if (k > 1) paste0("> ", bounds[-k], ", ≤ ", bounds[-1]) else character(0)
  c(paste0("≤ ", bounds[1]), middle, paste0("> ", bounds[k]))
}

cut_labels <- function(points) unique(bound_labels(points))

cut_points <- function(x, cut) {
  asked <- if (is.character(cut)) {
    stats::quantile(x, CUT_PROBS[[cut]], type = 7, na.rm = TRUE, names = FALSE)
  } else {
    cut
  }
  list(asked = asked, points = unique(asked))
}

cut_groups <- function(x, points) {
  as.character(cut(x, breaks = c(-Inf, points, Inf), right = TRUE, labels = bound_labels(points)))
}

# ---- The study's values ---------------------------------------------------------

# One result per participant for a biomarker at a visit, in the participant
# table's order; NA where there is no row or the result is empty.
result_at <- function(measure, visit) {
  rows <- results[results$TEST == measure & results$VISIT == visit, ]
  rows$STRESN[match(participants$USUBJID, rows$USUBJID)]
}

value_of <- function(measure, visit, value) {
  at <- if (identical(value, "baseline")) NA else result_at(measure, visit)
  baseline <- result_at(measure, "Baseline")
  switch(value,
    raw = at,
    baseline = baseline,
    change = at - baseline,
    fold_change = ifelse(baseline > 0, at / baseline, NA),
    percent_change = ifelse(baseline > 0, 100 * (at - baseline) / baseline, NA)
  )
}

# ---- JSON, by hand ----------------------------------------------------------------

num <- function(x) if (is.na(x)) "null" else sprintf("%.17g", x)
nums <- function(x) paste0("[", paste(vapply(x, num, character(1)), collapse = ","), "]")
# Text is written in ASCII: the one other character a label holds, the sign
# \u2264, is written as its JSON escape, whatever the locale R runs in.
str <- function(x) {
  if (is.null(x) || is.na(x)) return("null")
  paste0("\"", gsub("\u2264", "\\u2264", x, fixed = TRUE), "\"")
}
strs <- function(x) paste0("[", paste(vapply(x, str, character(1)), collapse = ","), "]")
lgl <- function(x) if (isTRUE(x)) "true" else "false"
cut_json <- function(cut) if (is.character(cut)) str(cut) else nums(cut)

# The variable as the settings write it, members that are not set left out.
variable_json <- function(variable) {
  if (is.null(variable)) return("null")
  parts <- vapply(names(variable), function(name) {
    value <- variable[[name]]
    paste0(str(name), ":", if (name == "cut") cut_json(value) else str(value))
  }, character(1))
  paste0("{", paste(parts, collapse = ","), "}")
}

filters_json <- function(filters) {
  if (length(filters) == 0) return("null")
  parts <- vapply(names(filters), function(name) paste0(str(name), ":", strs(filters[[name]])), character(1))
  paste0("{", paste(parts, collapse = ","), "}")
}

# How many of each group: every group, in order, with its count.
counts_json <- function(groups, labels) {
  paste0("[", paste(vapply(labels, function(label) as.character(sum(groups == label, na.rm = TRUE)), character(1)), collapse = ","), "]")
}

# One case: the values, the cut, and what R makes of them. `drawn`, when given,
# is a biomarker at a visit drawn by the cut groups, with `y` its value for the
# same participants: the count in each group of the participants who have a
# value of it, as the group comparison draws them.
case <- function(name, ids, x, cut, variable = NULL, filters = NULL, drawn = NULL, y = NULL) {
  made <- cut_points(x, cut)
  labels <- cut_labels(made$points)
  groups <- cut_groups(x, made$points)
  parts <- c(
    paste0("\"name\":", str(name)),
    paste0("\"variable\":", variable_json(variable)),
    paste0("\"filters\":", filters_json(filters)),
    paste0("\"cut\":", cut_json(cut)),
    paste0("\"ids\":", strs(ids)),
    paste0("\"values\":", nums(x)),
    paste0("\"n\":", sum(!is.na(x))),
    paste0("\"asked\":", nums(made$asked)),
    paste0("\"points\":", nums(made$points)),
    paste0("\"repeated\":", lgl(length(made$points) < length(made$asked))),
    paste0("\"merged\":", lgl(length(labels) < length(made$points) + 1)),
    paste0("\"labels\":", strs(labels)),
    paste0("\"groups\":", strs(groups)),
    paste0("\"counts\":", counts_json(groups, labels))
  )
  if (!is.null(drawn)) {
    shown <- ifelse(is.na(y), NA, groups)
    parts <- c(parts, paste0(
      "\"drawn\":{\"y\":", variable_json(drawn), ",\"counts\":", counts_json(shown, labels), "}"
    ))
  }
  paste0("    {", paste(parts, collapse = ","), "}")
}

# A study case: the cut variable read from the vendored tables, for the
# participants a filter on the participant table keeps, in the participant
# table's order.
study_case <- function(name, variable, cut, filters = NULL, drawn = NULL) {
  keep <- rep(TRUE, nrow(participants))
  for (column in names(filters)) keep <- keep & participants[[column]] %in% filters[[column]]
  x <- if (!is.null(variable$col)) {
    suppressWarnings(as.numeric(participants[[variable$col]]))
  } else {
    value_of(variable$measure, if (is.null(variable$visit)) NA else variable$visit, variable$value)
  }
  y <- if (is.null(drawn)) NULL else value_of(drawn$measure, drawn$visit, drawn$value)[keep]
  case(name, participants$USUBJID[keep], x[keep], cut, variable, filters, drawn, y)
}

crp <- list(measure = "CRP", visit = "Baseline", value = "raw")
il6 <- list(measure = "IL-6", visit = "Week 4", value = "change")
with_cut <- function(variable, cut) c(variable, list(cut = cut))

cases <- c(
  study_case("CRP at Baseline, cut at the median", with_cut(crp, "median"), "median", drawn = il6),
  study_case("CRP at Baseline, cut at the tertiles", with_cut(crp, "tertiles"), "tertiles", drawn = il6),
  study_case("CRP at Baseline, cut at the quartiles", with_cut(crp, "quartiles"), "quartiles", drawn = il6),
  study_case("CRP at Baseline, cut at 2 and 5", with_cut(crp, c(2, 5)), c(2, 5), drawn = il6),
  study_case(
    "IL-6 at baseline, cut at the median, for women",
    with_cut(list(measure = "IL-6", value = "baseline"), "median"), "median",
    filters = list(SEX = "F")
  ),
  study_case(
    "Age, cut at the quartiles: whole years, so values equal to a cut point",
    list(col = "AGE", type = "number", cut = "quartiles"), "quartiles"
  ),
  case(
    "Values equal to the median fall in the lower group",
    sprintf("E-%02d", 1:7), c(5, 1, 3, 3, 7, 2, 3), "median"
  ),
  case(
    "Ties make the quartiles repeat a point, which collapses",
    sprintf("E-%02d", 1:9), c(1, 1, 1, 1, 1, 2, 3, NA, 1), "quartiles"
  ),
  case(
    "Missing values are left out of the points and out of every group",
    sprintf("E-%02d", 1:8), c(NA, 0.1, 0.7, NA, 0.2, 0.9, 0.35, NA), "tertiles"
  ),
  case(
    "Typed points: a value equal to one falls in the lower group",
    sprintf("E-%02d", 1:6), c(-1, 0, 0.5, 1, 1.5, 2), c(0, 1.5)
  ),
  case(
    "Every value the same: one point, and an empty upper group",
    sprintf("E-%02d", 1:4), c(2.5, 2.5, 2.5, 2.5), "tertiles"
  ),
  case(
    "Bounds written to four significant digits, a tie rounded to even",
    sprintf("E-%02d", 1:4), c(2.0625, 2.0625, 123456.7, 0.000012345), c(0.000012345, 2.0625, 123456.7)
  ),
  case(
    "A point that is rounding noise next to zero is written in full, with no trailing zero",
    sprintf("E-%02d", 1:10), c(-3, -2, -0.99, 2.97, 3, 3.1, 3.2, 3.3, 3.4, 3.5), "quartiles"
  ),
  case(
    "Very small and very large typed points are written in full, as R writes them",
    sprintf("E-%02d", 1:9),
    c(-1, -1.2e-7, 0, 1e-150, 1e-20, 1.2e-7, 1, 3.382e21, 1e22),
    c(-0.000123449, 1e-150, 1.11e-16, 1e-7, 1.2e-7, 1.23456e20, 3.382e21)
  ),
  case(
    "Distinct quantile points written alike make groups with the same label, which merge",
    sprintf("E-%02d", 1:5), c(2.7926, 2.7928, 2.793, 2.7932, 2.7934), "quartiles"
  )
)

lines <- c(
  "{",
  paste0(
    "  \"made_by\": {\"script\":\"tools/r-cut.R\",\"r_version\":",
    str(paste(R.version$major, R.version$minor, sep = ".")),
    ",\"platform\":", str(R.version$platform), "},"
  ),
  "  \"cases\": [",
  paste(cases, collapse = ",\n"),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s\n", out, paste(R.version$major, R.version$minor, sep = ".")))
