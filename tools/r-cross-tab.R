#!/usr/bin/env Rscript
# Writes what desktop R says about the cross-tabulations the chart draws on the
# synthetic study: for each case the two-way table of counts, its totals and
# its row and column percentages, and what gsm.bio's Analyze_Contingency, as
# vendored in site/vendor/gsm.bio/statistics.R, answers for it, with the key a
# stored result is found by.
#
#   Rscript tools/r-cross-tab.R                 writes tests/fixtures/cross-tab-r.json
#   Rscript tools/r-cross-tab.R <output file>   writes somewhere else (the check
#                                               in scripts/check-r-fixtures.mjs)
#
# The chart's counts and percentages (src/cross-tab/structureData.js) and what
# it asks R (src/cross-tab/statistic.js) are held to this file by the unit tests
# and the browser tests named CT-*. The numbers in it are never typed in: rerun
# this script to change them.
#
# Nothing of bio.viz is used: the tables are read from the vendored CSV files,
# a biomarker is read as tools/r-group-comparison.R reads one, and a cut is the
# core's recipe, read from tools/r-cut.R, which holds the docs' copy of it.
#
# The JSON is written by hand (tools/r-json.R). Numbers with 17 significant
# digits, enough to read back the identical double.

# A label holds the sign ≤, so R must run in a UTF-8 locale.
if (!l10n_info()[["UTF-8"]]) {
  for (locale in c("C.UTF-8", "en_US.UTF-8")) {
    if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", locale)))) break
  }
}
if (!l10n_info()[["UTF-8"]]) stop("tools/r-cross-tab.R needs a UTF-8 locale (C.UTF-8 or en_US.UTF-8)")

args <- commandArgs(trailingOnly = TRUE)
study <- "site/data/synthetic-study"
vendored <- "site/vendor/gsm.bio"
if (!file.exists(file.path(vendored, "statistics.R"))) stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else "tests/fixtures/cross-tab-r.json"

source(file.path(vendored, "statistics.R"))
source("tools/r-json.R")
source("tools/r-order.R")

# The core's cut rule, as tools/r-cut.R holds it.
local({
  src <- readLines("tools/r-cut.R", encoding = "UTF-8")
  from <- grep("^CUT_PROBS <- ", src)
  to <- grep("^cut_groups <- function", src)
  to <- to + which(src[to:length(src)] == "}")[1] - 1
  eval(parse(text = src[from:to], encoding = "UTF-8"), envir = globalenv())
})

results <- utils::read.csv(file.path(study, "synthetic_results.csv"), stringsAsFactors = FALSE)
participants <- utils::read.csv(file.path(study, "synthetic_participants.csv"), stringsAsFactors = FALSE)

# ---- The recipe: the key of one table's stored result ---------------------------
#
# dfFrame  the table's rows, one per participant: the id, `row` and `col`, each
#          the participant's category as text (a cut variable's group label)
# lView    the view, by the chart's names: statistic, test ("chisq" or
#          "fisher"), row_by and col_by (each a column's name, or a cut variable
#          as the settings write one: list(measure =, visit =, value =, cut =),
#          without visit for a baseline value, or list(col =, type = "number",
#          cut =); typed cut points as a list), row_levels and col_levels (the
#          categories, in the order the chart shows them), baseline_visits,
#          baseline_stat, filters (a named list of column to values)

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

# A row or column variable as the identity writes it: a column's name, or the
# cut variable with its text members as text and its typed points as a list.
chart_variable <- function(variable) {
  if (is.character(variable)) return(variable)
  lapply(variable, function(member) if (is.numeric(member)) as.list(member) else chart_text(member))
}

# A member of the identity that is not set is left out, never written as null.
# A member that is a list of values is an unnamed list, so it is written as a
# JSON array whatever its length. Text is sorted by code point
# (`method = "radix"`), which is the order the chart sorts in. The baseline
# settings are named only when a cut biomarker reads a baseline: its value is a
# baseline, or a change from one.
reads_baseline <- function(variable) {
  is.list(variable) && !is.null(variable$measure) && !identical(variable$value, "raw")
}

cross_tab_key <- function(dfFrame, lView) {
  lDataId <- list(chart = "cross-tab", row_by = chart_variable(lView$row_by), col_by = chart_variable(lView$col_by))
  if (reads_baseline(lView$row_by) || reads_baseline(lView$col_by)) {
    if (!is.null(lView$baseline_visits)) lDataId$baseline_visits <- as.list(chart_text(lView$baseline_visits))
    lDataId$baseline_stat <- lView$baseline_stat
  }
  if (length(lView$filters) > 0) {
    lDataId$filters <- lapply(lView$filters, function(xValues) {
      as.list(sort(unique(chart_text(xValues)), method = "radix"))
    })
  }
  lArgs <- list(
    strRowCol = "row", strColCol = "col", strMethod = lView$test,
    chrRowGroups = as.list(chart_text(lView$row_levels)),
    chrColGroups = as.list(chart_text(lView$col_levels))
  )
  list(name = lView$statistic, args = lArgs, dataId = lDataId, rows = nrow(dfFrame))
}

# ---- The study's tables ----------------------------------------------------------

result_at <- function(measure, visit) {
  rows <- results[results$TEST == measure & results$VISIT == visit, ]
  rows$STRESN[match(participants$USUBJID, rows$USUBJID)]
}

# Whether a value is missing as the chart reads it: NA, empty, or white space
# alone. The white space is what JavaScript's String.prototype.trim() removes,
# all of it and nothing more: trimws()'s default, [ \t\r\n], misses the
# non-breaking space and the other Unicode spaces, and PCRE's [\h\v] adds
# U+0085 and U+180E and lacks U+FEFF.
# The characters themselves, so the pattern is UTF-8 and PCRE reads it so.
JS_SPACE <- "[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]"
is_blank <- function(value) is.na(value) | trimws(value, whitespace = JS_SPACE) == ""

# A variable's category for every participant: a column's value, or a cut
# biomarker's group, worked out on the participants kept.
category_of <- function(variable, keep, people = participants) {
  if (is.character(variable)) {
    # A value that is empty or only white space is missing, as the chart reads it.
    value <- people[[variable]]
    value[is_blank(value)] <- NA
    return(list(values = value, levels = NULL))
  }
  # The baseline is the result at Baseline, the one baseline visit the cases
  # name; the study has one row per participant there.
  x <- switch(variable$value,
    raw = result_at(variable$measure, variable$visit),
    change = result_at(variable$measure, variable$visit) - result_at(variable$measure, "Baseline")
  )
  x[!keep] <- NA
  points <- cut_points(x[keep], variable$cut)$points
  list(values = cut_groups(x, points), levels = cut_labels(points))
}

# A case: the table of two variables for the participants the filters keep,
# and R's answer. `people` is the participant table, the study's unless a case
# brings its own, which is then written into the case as `tables`.
case <- function(name, row_by, col_by, test, filters = list(), people = participants,
                 tables = NULL) {
  keep <- rep(TRUE, nrow(people))
  for (column in names(filters)) keep <- keep & people[[column]] %in% filters[[column]]
  rows <- category_of(row_by, keep, people)
  cols <- category_of(col_by, keep, people)
  used <- keep & !is.na(rows$values) & !is.na(cols$values)
  # The categories, in the order the table draws them and R is handed them: a
  # cut's low to high, a column's by name with numbers as numbers
  # (tools/r-order.R), of the participants with both. Fisher's odds ratio is
  # of the table in this order.
  row_levels <- if (is.null(rows$levels)) natural_sort(unique(rows$values[used])) else rows$levels
  col_levels <- if (is.null(cols$levels)) natural_sort(unique(cols$values[used])) else cols$levels
  row_levels <- row_levels[row_levels %in% rows$values[used]]
  col_levels <- col_levels[col_levels %in% cols$values[used]]
  frame <- data.frame(
    USUBJID = people$USUBJID[used], row = rows$values[used], col = cols$values[used],
    stringsAsFactors = FALSE
  )
  counts <- unclass(table(factor(frame$row, levels = row_levels), factor(frame$col, levels = col_levels)))
  dimnames(counts) <- NULL
  view <- list(
    statistic = "Analyze_Contingency", test = test, row_by = row_by, col_by = col_by,
    row_levels = row_levels, col_levels = col_levels, baseline_visits = "Baseline",
    baseline_stat = "mean", filters = filters
  )
  key <- cross_tab_key(frame, view)
  value <- do.call(key$name, c(list(frame), key$args))
  matrix_rows <- function(m) lapply(seq_len(nrow(m)), function(i) unname(m[i, ]))
  c(
    list(
      case = name, participants = sum(keep), tables = tables,
      ids = as.list(frame$USUBJID), row_of = as.list(frame$row), col_of = as.list(frame$col),
      row_levels = as.list(row_levels),
      col_levels = as.list(col_levels),
      counts = matrix_rows(counts), row_totals = unname(rowSums(counts)),
      col_totals = unname(colSums(counts)), total = sum(counts),
      row_percent = matrix_rows(100 * counts / rowSums(counts)),
      col_percent = matrix_rows(t(100 * t(counts) / colSums(counts))),
      # Each percentage as R prints it to one decimal, as the table prints it.
      row_percent_text = matrix_rows(percent_text(100 * counts / rowSums(counts))),
      col_percent_text = matrix_rows(percent_text(t(100 * t(counts) / colSums(counts))))
    ),
    key,
    list(value = value)
  )
}

# A percentage to one decimal as R's sprintf() prints it: C's printf, which
# rounds the exact binary value, and a value exactly halfway (6.25, whose binary
# value is exact) to the even digit.
percent_text <- function(x) {
  out <- x
  out[] <- sprintf("%.1f%%", x)
  out
}
# Values that are exactly halfway at one decimal, and two that look halfway and
# are not in binary (0.15 is a little below, 0.35 a little above), with R's
# text for each.
percent_samples <- c(6.25, 6.75, 0.25, 12.5, 87.5, 99.75, 0.15, 0.35, 100 / 3, 200 / 3, 0, 100)

crp <- function(cut) list(measure = "CRP", visit = "Baseline", value = "raw", cut = cut)

# Levels whose order depends on how they are sorted: numbers in text (Week 2
# and Week 10), a difference of case (week 1), a letter outside ASCII (Ödem),
# and a value of white space alone, which is missing. Made here, not drawn
# from the study, and written into the case so the chart reads the same table.
levels_people <- local({
  i <- seq_len(48)
  grade <- c("a", "B")[((i - 1) %/% 4) %% 2 + 1]
  # White space alone: a space, a non-breaking space, an em space.
  grade[i %% 7 == 0] <- c(" ", "\u00a0", "\u2003")[(i[i %% 7 == 0] / 7 - 1) %% 3 + 1]
  data.frame(
    USUBJID = sprintf("L-%02d", i),
    STAGE = c("Week 2", "Week 10", "week 1", "\u00d6dem")[(i - 1) %% 4 + 1],
    GRADE = grade,
    stringsAsFactors = FALSE
  )
})
levels_tables <- list(
  participants = levels_people,
  results = data.frame(
    USUBJID = levels_people$USUBJID, VISIT = "Day 1", VISITNUM = 1, TEST = "X", STRESU = "u",
    STRESN = 1, stringsAsFactors = FALSE
  )
)

# The study's arms renamed as doses, Placebo "2 mg" and Treatment "10 mg": by
# code point "10 mg" comes first, by name with numbers as numbers "2 mg" does,
# so the table's order and the order R is handed its rows must be the same one
# for Fisher's odds ratio to be of the table drawn. Written into the case so
# the chart reads the same table.
dose_people <- data.frame(
  USUBJID = participants$USUBJID,
  ARM = c(Placebo = "2 mg", Treatment = "10 mg")[participants$ARM],
  RESPONSE = participants$RESPONSE,
  stringsAsFactors = FALSE,
  row.names = NULL
)
dose_tables <- list(
  participants = dose_people,
  results = data.frame(
    USUBJID = dose_people$USUBJID, VISIT = "Day 1", VISITNUM = 1, TEST = "X", STRESU = "u",
    STRESN = 1, stringsAsFactors = FALSE
  )
)

cases <- list(
  case("arm-by-response-chisq", "ARM", "RESPONSE", "chisq"),
  case("arm-by-response-fisher", "ARM", "RESPONSE", "fisher"),
  case("response-by-crp-median-chisq", "RESPONSE", crp("median"), "chisq"),
  case("response-by-crp-median-fisher", "RESPONSE", crp("median"), "fisher"),
  case("response-by-crp-typed-chisq", "RESPONSE", crp(8), "chisq"),
  case("arm-by-response-women-chisq", "ARM", "RESPONSE", "chisq", list(SEX = "F")),
  # CRP cut at 10 leaves 4 participants above it: below R's minimum group size.
  case("response-by-crp-10-chisq", "RESPONSE", crp(10), "chisq"),
  case(
    "arm-by-crp-change-median-chisq", "ARM",
    list(measure = "CRP", visit = "Week 4", value = "change", cut = "median"), "chisq"
  ),
  case("stage-by-grade-chisq", "STAGE", "GRADE", "chisq", people = levels_people,
       tables = levels_tables),
  case("dose-by-response-fisher", "ARM", "RESPONSE", "fisher", people = dose_people,
       tables = dose_tables)
)

record <- paste(readLines(file.path(vendored, "SOURCE.json"), warn = FALSE), collapse = "\n")
recorded <- function(member) sub(sprintf('.*"%s": "([^"]*)".*', member), "\\1", record)
made_by <- list(
  script = "tools/r-cross-tab.R",
  r_version = paste(R.version$major, R.version$minor, sep = "."),
  platform = R.version$platform,
  statistics_file = file.path(vendored, "statistics.R"),
  statistics_commit = recorded("commit"),
  statistics_sha256 = recorded("sha256")
)

# Text is written in ASCII: the sign ≤ of a cut's label as its JSON escape.
ascii <- function(text) gsub("≤", "\\u2264", text, fixed = TRUE)
# Every character of the Basic Multilingual Plane the recipe reads as white
# space alone, by its code point (NUL, which no R string holds, and the
# surrogates left out): the unit tests hold it to JavaScript's trim().
blank_code_points <- local({
  code <- setdiff(1:65535, 55296:57343)
  code[is_blank(intToUtf8(code, multiple = TRUE))]
})

lines <- c(
  "{",
  paste0("  \"made_by\": ", to_json(made_by), ","),
  paste0("  \"blank_code_points\": ", to_json(as.list(as.integer(blank_code_points))), ","),
  paste0("  \"category_order\": ", ascii(to_json(list(
    given = as.list(order_samples), sorted = as.list(natural_sort(order_samples))
  ))), ","),
  paste0("  \"percent_text\": ", to_json(lapply(percent_samples, function(value) {
    list(value = value, text = sprintf("%.1f%%", value))
  })), ","),
  "  \"cases\": [",
  paste0("    ", vapply(cases, function(entry) ascii(to_json(entry)), character(1)),
         c(rep(",", length(cases) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s: %d cases from gsm.bio's statistics at %s\n", out,
            made_by$r_version, length(cases), substr(made_by$statistics_commit, 1, 7)))
