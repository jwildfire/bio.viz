# Writes an R value as JSON, for the scripts that write a chart's expected
# results (tools/r-group-statistics.R, tools/r-association-statistics.R). Sourced
# by them from the repository root; it defines functions and runs nothing.
#
# Base R only. The JSON is written by hand, following the rules by which
# bio.viz's connection turns an R value into JavaScript (docs/r-connection.md),
# so that a file holds each value in exactly the shape R in the browser returns
# it. Numbers are written with 17 significant digits, which is enough to read
# back the identical double.
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
