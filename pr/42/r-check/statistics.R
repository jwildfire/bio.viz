# The R the check page runs: two thin wrappers, each around one R function, and
# a note of which R answered. The same file is given to R in the browser by the
# page and sourced by tools/r-fixtures.R in desktop R, so both run one source.
#
# Each function takes the table first and names of its columns after, and
# returns a list in one shape: the method's name, the p-value, the statistic,
# the counts used (a named vector, one count per group) and any warnings R
# raised. Nothing is reimplemented: the numbers are those of wilcox.test and
# survival::survdiff.

# Runs `expr`, keeping R's warnings as text instead of letting them go to the
# console.
with_warnings <- function(expr) {
  warnings <- character()
  value <- withCallingHandlers(expr, warning = function(w) {
    warnings <<- c(warnings, conditionMessage(w))
    invokeRestart("muffleWarning")
  })
  list(value = value, warnings = as.list(warnings))
}

# Wilcoxon rank-sum test of a numeric column between two groups, with R's
# defaults (wilcox.test chooses exact or approximate itself).
rank_sum <- function(data, value, group) {
  x <- data[[value]]
  g <- data[[group]]
  keep <- !is.na(x) & !is.na(g)
  frame <- data.frame(x = x[keep], g = factor(g[keep]))
  ran <- with_warnings(stats::wilcox.test(x ~ g, data = frame))
  test <- ran$value
  n <- table(frame$g)
  list(
    method = unname(test$method),
    p_value = unname(test$p.value),
    statistic = unname(test$statistic),
    counts = stats::setNames(as.integer(n), names(n)),
    warnings = ran$warnings
  )
}

# Log-rank test of time to an event between two or more groups.
log_rank <- function(data, time, event, group) {
  frame <- data.frame(
    time = data[[time]],
    status = as.integer(data[[event]]),
    group = factor(data[[group]])
  )
  frame <- frame[stats::complete.cases(frame), ]
  ran <- with_warnings(
    survival::survdiff(survival::Surv(time, status) ~ group, data = frame)
  )
  fit <- ran$value
  groups <- sub("^group=", "", names(fit$n))
  df <- length(groups) - 1L
  list(
    method = "Log-rank test",
    p_value = stats::pchisq(fit$chisq, df, lower.tail = FALSE),
    statistic = unname(fit$chisq),
    df = df,
    counts = stats::setNames(as.integer(fit$n), groups),
    groups = data.frame(
      group = groups,
      n = as.integer(fit$n),
      observed = as.numeric(fit$obs),
      expected = as.numeric(fit$exp),
      stringsAsFactors = FALSE
    ),
    warnings = ran$warnings
  )
}

# Which R this is. Takes the table like every other function and ignores it.
r_session <- function(data) {
  list(
    r_version = paste(R.version$major, R.version$minor, sep = "."),
    survival_version = as.character(utils::packageVersion("survival")),
    platform = R.version$platform
  )
}
