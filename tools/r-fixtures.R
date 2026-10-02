#!/usr/bin/env Rscript
# Writes the expected results for the R check page: what desktop R answers when
# it runs site/r-check/statistics.R on the two tables in site/r-check/data/.
#
#   Rscript tools/r-fixtures.R                 writes site/r-check/expected.json
#   Rscript tools/r-fixtures.R <output file>   writes somewhere else (the check
#                                              in scripts/check-r-fixtures.mjs)
#
# The file records the R version and survival version that made it. The numbers
# in it are never typed in: rerun this script to change them.
#
# Base R and survival only. The JSON is written by hand below, following the
# rules by which bio.viz's connection turns an R value into JavaScript (see
# docs/r-connection.md), so that the file holds each value in exactly the shape
# R in the browser returns it:
#
#   data frame                array of row objects
#   named list, named vector  object
#   unnamed list              array
#   unnamed vector, length 1  a single value
#   unnamed vector, otherwise array
#   NA, NULL                  null
#
# Numbers are written with 17 significant digits, which is enough to read back
# the identical double.

args <- commandArgs(trailingOnly = TRUE)
root <- if (file.exists("site/r-check/statistics.R")) "." else stop("run from the repository root")
out <- if (length(args) >= 1) args[[1]] else file.path(root, "site/r-check/expected.json")

suppressPackageStartupMessages(library(survival))
source(file.path(root, "site/r-check/statistics.R"))

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

read_table <- function(file) {
  utils::read.csv(file.path(root, "site/r-check/data", file), stringsAsFactors = FALSE)
}

# One entry per test: the function, its arguments, the table it ran on, and what
# it returned. An entry is a stored result in the connection's format, so the
# page hands this list to the precomputed form as it is.
check <- function(name, args, file, data_id) {
  data <- read_table(file)
  list(
    name = name,
    args = args,
    dataId = data_id,
    file = file,
    rows = nrow(data),
    value = do.call(name, c(list(data), args))
  )
}

results <- list(
  check(
    "rank_sum", list(value = "AVAL", group = "ARM"), "alt-week-8.csv",
    "Alanine Aminotransferase at Week 8, Placebo and Xanomeline High Dose"
  ),
  check(
    "log_rank", list(time = "DAYS", event = "DISCONTINUED", group = "ARM"), "days-on-study.csv",
    "Days on study, all participants, three arms"
  )
)

expected <- list(
  made_by = c(list(script = "tools/r-fixtures.R"), r_session(NULL)),
  results = results
)

# One member per line at the top two levels, so a change to one result is a
# one-line change in review.
lines <- c(
  "{",
  paste0("  \"made_by\": ", to_json(expected$made_by), ","),
  "  \"results\": [",
  paste0("    ", vapply(results, to_json, character(1)), c(rep(",", length(results) - 1), "")),
  "  ]",
  "}"
)
writeLines(lines, out)
cat(sprintf("Wrote %s with R %s and survival %s\n", out,
            expected$made_by$r_version, expected$made_by$survival_version))
