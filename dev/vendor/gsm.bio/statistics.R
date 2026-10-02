# gsm.bio statistics
#
# The one definition of every statistics function in gsm.bio. The package's
# exported functions are built from this file when the package is installed,
# and the same file is handed to R in the browser, or to a server, as it is.
# So it stands alone: it calls base R, the stats package and the survival
# package and nothing else, each by name (stats::, survival::), it never
# attaches or loads a package, and it never evaluates text.
#
# Every Analyze_* function takes a data frame with one row per participant
# first, and after it only named arguments that JSON can carry: strings,
# numbers, booleans and vectors of those. An argument that takes several
# values accepts a vector or an unnamed list of single values. No argument is
# a formula, a function or an expression.
#
# Each statistic is the R function the design names, called with R's own
# defaults. Nothing is reimplemented but the standardised difference, which is
# a few lines here to avoid a heavy dependency. The wrappers fix the inputs,
# drop and count what cannot be used, and put the answer in one shape
# (Stat_Result, below). They never raise an error and never emit a warning:
# both become part of the answer.
#
# An answer is the answer of the R that computed it. R's defaults are R's to
# change, and a few have changed between versions, so the same call on the
# same data can differ between an older R and a newer one.

# The smallest group a statistic is computed for, when the caller does not say.
# A default, not an agreed or validated threshold.
nMinGroupDefault <- 5L

# The expected count below which chisq.test() itself warns that its
# approximation may be incorrect.
nSmallExpectedCount <- 5

# ---- The result shape -------------------------------------------------------
#
# Every function returns a plain named list with these members, always all of
# them and always in this order. Only base R is needed to turn it into JSON:
# there is no factor, no matrix and no classed object other than a plain data
# frame, a single value is an unnamed vector of length one, and anything that
# is a collection is a data frame or an unnamed list, never a bare vector.
#
#   status      "ok", "too_small" or "error"
#   reason      why there are no numbers; NA when status is "ok"
#   test        the method asked for, as the caller named it
#   method      the method's name as R reports it
#   estimates   data frame: name, group, estimate, lower, upper, level
#   statistic   data frame: name, value (the statistic, then its parameters)
#   p_value     one number, or NA
#   adjustment  how p_value was adjusted; "none" when it was not
#   counts      the participants used: one whole number, or a named list of
#               group to whole number
#   dropped     data frame: reason, n (the rows left out, and why)
#   warnings    unnamed list of the warnings R raised, as text
#   notes       unnamed list of remarks of our own, as text
#   rows        data frame of the function's many-row results; no rows if none

Stat_Estimates <- function(chrName = character(0), chrGroup = NA_character_, nEstimate = numeric(0),
                           nLower = NA_real_, nUpper = NA_real_, nLevel = NA_real_) {
  nRows <- length(chrName)
  data.frame(
    name = chrName,
    group = rep_len(as.character(chrGroup), nRows),
    estimate = as.numeric(nEstimate),
    lower = rep_len(as.numeric(nLower), nRows),
    upper = rep_len(as.numeric(nUpper), nRows),
    level = rep_len(as.numeric(nLevel), nRows),
    stringsAsFactors = FALSE
  )
}

Stat_Statistic <- function(chrName = character(0), nValue = numeric(0)) {
  data.frame(name = as.character(chrName), value = as.numeric(nValue), stringsAsFactors = FALSE)
}

# Only the reasons that dropped something are listed.
Stat_Dropped <- function(chrReason = character(0), nRows = integer(0)) {
  bAny <- nRows > 0
  data.frame(reason = as.character(chrReason[bAny]), n = as.integer(nRows[bAny]), stringsAsFactors = FALSE)
}

Stat_Result <- function(strTest = NA_character_, strStatus = "ok", strReason = NA_character_,
                        strMethod = NA_character_, dfEstimates = Stat_Estimates(),
                        dfStatistic = Stat_Statistic(), nPValue = NA_real_, strAdjustment = "none",
                        xCounts = NA_integer_, dfDropped = Stat_Dropped(), chrWarnings = character(0),
                        chrNotes = character(0), dfRows = data.frame()) {
  list(
    status = strStatus,
    reason = strReason,
    test = strTest,
    method = strMethod,
    estimates = dfEstimates,
    statistic = dfStatistic,
    p_value = as.numeric(nPValue),
    adjustment = strAdjustment,
    counts = xCounts,
    dropped = dfDropped,
    warnings = as.list(unique(as.character(chrWarnings))),
    notes = as.list(as.character(chrNotes)),
    rows = dfRows
  )
}

# One whole number per group, as a named list.
Stat_GroupCounts <- function(chrGroups, nCounts) {
  stats::setNames(as.list(as.integer(nCounts)), chrGroups)
}

# ---- Running R without letting an error or a warning escape -----------------

# Call fnCall and return its value with the warnings it raised and the message
# of the error that stopped it, if one did.
Stat_Capture <- function(fnCall) {
  chrWarnings <- character(0)
  strError <- NA_character_
  xValue <- withCallingHandlers(
    tryCatch(
      fnCall(),
      error = function(cndError) {
        strError <<- conditionMessage(cndError)
        NULL
      }
    ),
    warning = function(cndWarning) {
      chrWarnings <<- c(chrWarnings, conditionMessage(cndWarning))
      invokeRestart("muffleWarning")
    }
  )
  list(value = xValue, warnings = chrWarnings, error = strError)
}

# Run a whole function body. Anything it stops on, a bad argument or a column
# that is not there, comes back as an "error" result carrying the message.
Stat_Run <- function(strTest, fnBody) {
  lRun <- Stat_Capture(fnBody)
  if (is.na(lRun$error)) {
    return(lRun$value)
  }
  bLabel <- is.character(strTest) && length(strTest) == 1L
  Stat_Result(
    strTest = if (bLabel) strTest else NA_character_,
    strStatus = "error",
    strReason = lRun$error,
    chrWarnings = lRun$warnings
  )
}

# The parts of an htest that every wrapper reports.
Stat_FromTest <- function(lTest) {
  list(
    method = unname(lTest$method),
    statistic = Stat_Statistic(
      c(names(lTest$statistic), names(lTest$parameter)),
      c(unname(lTest$statistic), unname(lTest$parameter))
    ),
    p_value = unname(lTest$p.value)
  )
}

# ---- Reading the arguments and the columns ----------------------------------

Stat_CheckData <- function(dfData) {
  if (!is.data.frame(dfData)) {
    stop("dfData must be a data frame with one row per participant.", call. = FALSE)
  }
  invisible(dfData)
}

Stat_CheckString <- function(strValue, strArg) {
  if (!is.character(strValue) || length(strValue) != 1L || is.na(strValue) || !nzchar(strValue)) {
    stop(sprintf("%s must be one string.", strArg), call. = FALSE)
  }
  strValue
}

Stat_CheckChoice <- function(strValue, chrChoices, strArg) {
  Stat_CheckString(strValue, strArg)
  if (!strValue %in% chrChoices) {
    stop(
      sprintf("%s must be one of: %s. It was '%s'.", strArg, paste(chrChoices, collapse = ", "), strValue),
      call. = FALSE
    )
  }
  strValue
}

Stat_CheckFlag <- function(bValue, strArg) {
  if (!is.logical(bValue) || length(bValue) != 1L || is.na(bValue)) {
    stop(sprintf("%s must be TRUE or FALSE.", strArg), call. = FALSE)
  }
  bValue
}

Stat_CheckNumber <- function(nValue, strArg, nAbove = -Inf, nBelow = Inf) {
  if (!is.numeric(nValue) || length(nValue) != 1L || is.na(nValue) || nValue <= nAbove || nValue >= nBelow) {
    stop(sprintf("%s must be one number above %s and below %s.", strArg, nAbove, nBelow), call. = FALSE)
  }
  as.numeric(nValue)
}

# An argument that takes several values arrives as a vector or, from JSON, as
# an unnamed list of single values. NULL means the caller left it out.
Stat_Vector <- function(xValue, strArg) {
  if (is.null(xValue)) {
    return(NULL)
  }
  if (is.list(xValue)) {
    bSingle <- vapply(xValue, function(xItem) is.atomic(xItem) && length(xItem) == 1L, logical(1))
    if (!all(bSingle)) {
      stop(sprintf("%s must be a vector, or a list of single values.", strArg), call. = FALSE)
    }
    xValue <- unlist(xValue, use.names = FALSE)
  }
  chrValue <- as.character(xValue)
  if (length(chrValue) == 0L || anyNA(chrValue) || anyDuplicated(chrValue) > 0L) {
    stop(sprintf("%s must name one or more different values, none missing.", strArg), call. = FALSE)
  }
  chrValue
}

Stat_Column <- function(dfData, strCol, strArg) {
  Stat_CheckString(strCol, strArg)
  if (!strCol %in% names(dfData)) {
    stop(sprintf("Column '%s' (%s) is not in the data.", strCol, strArg), call. = FALSE)
  }
  xCol <- dfData[[strCol]]
  if (is.list(xCol) || !is.null(dim(xCol))) {
    stop(sprintf("Column '%s' (%s) does not hold one value per row.", strCol, strArg), call. = FALSE)
  }
  xCol
}

# A number per row. Whole numbers and decimals are both numbers; a value that
# is missing or not finite is NA; a column with nothing in it at all, which
# JSON delivers as logical, is all NA. Anything else is refused.
Stat_Numeric <- function(dfData, strCol, strArg) {
  xCol <- Stat_Column(dfData, strCol, strArg)
  if (is.logical(xCol) && all(is.na(xCol))) {
    return(rep(NA_real_, length(xCol)))
  }
  if (!is.numeric(xCol)) {
    stop(sprintf("Column '%s' (%s) is not numeric.", strCol, strArg), call. = FALSE)
  }
  nCol <- as.numeric(xCol)
  nCol[!is.finite(nCol)] <- NA_real_
  nCol
}

# A category per row, as text. A factor gives its labels; a missing value and
# an empty string are both NA.
Stat_Category <- function(dfData, strCol, strArg) {
  chrCol <- as.character(Stat_Column(dfData, strCol, strArg))
  chrCol[!is.na(chrCol) & !nzchar(chrCol)] <- NA_character_
  chrCol
}

# The groups to use, in order: the ones the caller named, or every one present,
# sorted the same way in every locale.
Stat_Levels <- function(chrCategory, xGroups, strArg) {
  chrGroups <- Stat_Vector(xGroups, strArg)
  if (is.null(chrGroups)) {
    chrGroups <- sort(unique(chrCategory[!is.na(chrCategory)]), method = "radix")
  }
  chrGroups
}

Stat_TooSmallReason <- function(chrGroups, nCounts, nMinGroup) {
  bSmall <- nCounts < nMinGroup
  sprintf(
    "Not computed: %s. The minimum group size is %s.",
    paste(sprintf("%s has %d", chrGroups[bSmall], as.integer(nCounts[bSmall])), collapse = "; "),
    format(nMinGroup)
  )
}

# ---- Group comparison -------------------------------------------------------

# A value per row, split by group. Rows with no group, with a group that was
# not asked for, or with no value are dropped and counted, in that order.
Stat_SplitByGroup <- function(nValue, chrGroup, chrLevels) {
  bNoGroup <- is.na(chrGroup)
  bOtherGroup <- !bNoGroup & !chrGroup %in% chrLevels
  bNoValue <- !bNoGroup & !bOtherGroup & is.na(nValue)
  bUsed <- !bNoGroup & !bOtherGroup & !bNoValue
  lValues <- lapply(chrLevels, function(strLevel) nValue[bUsed & chrGroup == strLevel])
  list(
    used = bUsed,
    values = lValues,
    counts = vapply(lValues, length, integer(1)),
    dropped = Stat_Dropped(
      c("Missing group", "Group not selected", "Missing value"),
      c(sum(bNoGroup), sum(bOtherGroup), sum(bNoValue))
    )
  )
}

# Welch's t-test between two groups, for the difference in means and its
# interval: the first group's mean minus the second's.
Stat_Welch <- function(nFirst, nSecond, nConfLevel) {
  lRun <- Stat_Capture(function() stats::t.test(nFirst, nSecond, conf.level = nConfLevel))
  if (!is.na(lRun$error)) {
    return(lRun)
  }
  lRun$difference <- unname(lRun$value$estimate[1] - lRun$value$estimate[2])
  lRun$lower <- lRun$value$conf.int[1]
  lRun$upper <- lRun$value$conf.int[2]
  lRun
}

Analyze_GroupDifference <- function(dfData, strValueCol, strGroupCol, strMethod = "t", chrGroups = NULL,
                                    bPairwise = TRUE, strPAdjust = "holm", nConfLevel = 0.95,
                                    nMinGroup = nMinGroupDefault) {
  Stat_Run(strMethod, function() {
    Stat_CheckData(dfData)
    Stat_CheckChoice(strMethod, c("t", "wilcoxon", "anova", "kruskal"), "strMethod")
    Stat_CheckFlag(bPairwise, "bPairwise")
    Stat_CheckChoice(strPAdjust, stats::p.adjust.methods, "strPAdjust")
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinGroup, "nMinGroup", 0)
    nValue <- Stat_Numeric(dfData, strValueCol, "strValueCol")
    chrGroup <- Stat_Category(dfData, strGroupCol, "strGroupCol")
    chrLevels <- Stat_Levels(chrGroup, chrGroups, "chrGroups")

    lSplit <- Stat_SplitByGroup(nValue, chrGroup, chrLevels)
    bUsed <- lSplit$used
    dfDropped <- lSplit$dropped
    lValues <- lSplit$values
    nCounts <- lSplit$counts
    lCounts <- Stat_GroupCounts(chrLevels, nCounts)
    nGroups <- length(chrLevels)
    bTwoGroupTest <- strMethod %in% c("t", "wilcoxon")

    if (nGroups < 2L || (bTwoGroupTest && nGroups != 2L)) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "error", xCounts = lCounts, dfDropped = dfDropped,
        strReason = if (bTwoGroupTest) {
          sprintf(
            "'%s' compares exactly two groups and %d were found. Name two in chrGroups, or use 'anova' or 'kruskal'.",
            strMethod, nGroups
          )
        } else {
          sprintf("'%s' compares two or more groups and %d was found.", strMethod, nGroups)
        }
      ))
    }
    if (any(nCounts < nMinGroup)) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "too_small", xCounts = lCounts, dfDropped = dfDropped,
        strReason = Stat_TooSmallReason(chrLevels, nCounts, nMinGroup)
      ))
    }

    dfEstimates <- Stat_Estimates(rep("Mean", nGroups), chrLevels, vapply(lValues, mean, numeric(1)))
    chrWarnings <- character(0)
    chrNotes <- character(0)

    # With two groups, the difference in means and its interval come from
    # t.test(), whichever test was asked for.
    lWelch <- NULL
    if (nGroups == 2L) {
      lWelch <- Stat_Welch(lValues[[1]], lValues[[2]], nConfLevel)
      if (!is.na(lWelch$error)) {
        return(Stat_Result(
          strTest = strMethod, strStatus = "error", strReason = lWelch$error, xCounts = lCounts,
          dfDropped = dfDropped, chrWarnings = lWelch$warnings
        ))
      }
      chrWarnings <- c(chrWarnings, lWelch$warnings)
      dfEstimates <- rbind(dfEstimates, Stat_Estimates(
        "Difference in means", paste(chrLevels[1], "-", chrLevels[2]),
        lWelch$difference, lWelch$lower, lWelch$upper, nConfLevel
      ))
      if (strMethod != "t") {
        chrNotes <- c(chrNotes, "The difference in means and its interval are from t.test() (Welch), whatever the test.")
      }
    }

    # The rows used, in the order they came, for the tests that take them all.
    dfModel <- data.frame(Value = nValue[bUsed], Group = factor(chrGroup[bUsed], levels = chrLevels))
    lTest <- if (strMethod == "t") {
      lWelch
    } else if (strMethod == "wilcoxon") {
      Stat_Capture(function() stats::wilcox.test(lValues[[1]], lValues[[2]]))
    } else if (strMethod == "anova") {
      Stat_Capture(function() summary(stats::aov(Value ~ Group, data = dfModel))[[1]])
    } else {
      Stat_Capture(function() stats::kruskal.test(dfModel$Value, dfModel$Group))
    }
    if (!is.na(lTest$error)) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "error", strReason = lTest$error, xCounts = lCounts,
        dfDropped = dfDropped, chrWarnings = c(chrWarnings, lTest$warnings)
      ))
    }
    if (strMethod != "t") {
      chrWarnings <- c(chrWarnings, lTest$warnings)
    }
    lParts <- if (strMethod == "anova") {
      # aov() has no name for itself; this one is ours.
      list(
        method = "One-way analysis of variance",
        statistic = Stat_Statistic(c("F", "num df", "denom df"), c(lTest$value[1, "F value"], lTest$value[, "Df"])),
        p_value = lTest$value[1, "Pr(>F)"]
      )
    } else {
      Stat_FromTest(lTest$value)
    }

    # With more than two groups, each pair is compared with the two-group test
    # of the same family and the p-values are adjusted across the pairs.
    dfRows <- data.frame()
    if (nGroups > 2L && bPairwise) {
      nPairs <- nGroups * (nGroups - 1L) / 2L
      iFirst <- rep(seq_len(nGroups - 1L), times = rev(seq_len(nGroups - 1L)))
      iSecond <- unlist(lapply(seq_len(nGroups - 1L), function(iGroup) seq(iGroup + 1L, nGroups)))
      dfRows <- data.frame(
        group_1 = chrLevels[iFirst], group_2 = chrLevels[iSecond],
        n_1 = nCounts[iFirst], n_2 = nCounts[iSecond], counts = nCounts[iFirst] + nCounts[iSecond],
        estimate = NA_real_, lower = NA_real_, upper = NA_real_, level = nConfLevel,
        method = NA_character_, statistic = NA_real_, p_unadjusted = NA_real_, p_value = NA_real_,
        adjustment = strPAdjust, status = "ok", reason = NA_character_, warning = NA_character_,
        stringsAsFactors = FALSE
      )
      for (iPair in seq_len(nPairs)) {
        nFirst <- lValues[[iFirst[iPair]]]
        nSecond <- lValues[[iSecond[iPair]]]
        lPairWelch <- Stat_Welch(nFirst, nSecond, nConfLevel)
        lPairTest <- if (strMethod == "anova") {
          lPairWelch
        } else {
          Stat_Capture(function() stats::wilcox.test(nFirst, nSecond))
        }
        chrPairWarnings <- unique(c(lPairWelch$warnings, lPairTest$warnings))
        chrPairErrors <- unique(c(lPairWelch$error, lPairTest$error))
        chrPairErrors <- chrPairErrors[!is.na(chrPairErrors)]
        if (length(chrPairWarnings) > 0L) {
          dfRows$warning[iPair] <- paste(chrPairWarnings, collapse = "; ")
          chrWarnings <- c(chrWarnings, chrPairWarnings)
        }
        if (length(chrPairErrors) > 0L) {
          dfRows$status[iPair] <- "error"
          dfRows$reason[iPair] <- paste(chrPairErrors, collapse = "; ")
        } else {
          lPairParts <- Stat_FromTest(lPairTest$value)
          dfRows$estimate[iPair] <- lPairWelch$difference
          dfRows$lower[iPair] <- lPairWelch$lower
          dfRows$upper[iPair] <- lPairWelch$upper
          dfRows$method[iPair] <- lPairParts$method
          dfRows$statistic[iPair] <- lPairParts$statistic$value[1]
          dfRows$p_unadjusted[iPair] <- lPairParts$p_value
        }
      }
      dfRows$p_value <- stats::p.adjust(dfRows$p_unadjusted, method = strPAdjust)
      chrNotes <- c(chrNotes, sprintf(
        "Pairwise: each pair is compared with %s; p_value is adjusted across the pairs by p.adjust(method = '%s'); the intervals are not adjusted.",
        if (strMethod == "anova") "t.test() (Welch)" else "wilcox.test()", strPAdjust
      ))
    }

    Stat_Result(
      strTest = strMethod, strMethod = lParts$method, dfEstimates = dfEstimates,
      dfStatistic = lParts$statistic, nPValue = lParts$p_value, xCounts = lCounts,
      dfDropped = dfDropped, chrWarnings = chrWarnings, chrNotes = chrNotes, dfRows = dfRows
    )
  })
}

# ---- Correlation ------------------------------------------------------------

# cor.test() on the complete pairs of two numeric vectors. Returns plain
# pieces, for one overall answer, one group's row or one cell of a matrix.
Stat_CorrelationPair <- function(nX, nY, strMethod, nConfLevel, nMinGroup) {
  bPair <- !is.na(nX) & !is.na(nY)
  lPair <- list(
    status = "ok", reason = NA_character_, counts = sum(bPair), method = NA_character_,
    name = NA_character_, estimate = NA_real_, lower = NA_real_, upper = NA_real_, level = NA_real_,
    statistic = Stat_Statistic(), p_value = NA_real_, warnings = character(0)
  )
  if (lPair$counts < nMinGroup) {
    lPair$status <- "too_small"
    lPair$reason <- sprintf(
      "Not computed: %d complete pairs. The minimum is %s.", lPair$counts, format(nMinGroup)
    )
    return(lPair)
  }
  lRun <- Stat_Capture(function() {
    stats::cor.test(nX[bPair], nY[bPair], method = strMethod, conf.level = nConfLevel)
  })
  lPair$warnings <- lRun$warnings
  if (!is.na(lRun$error)) {
    lPair$status <- "error"
    lPair$reason <- lRun$error
    return(lPair)
  }
  lParts <- Stat_FromTest(lRun$value)
  lPair$method <- lParts$method
  lPair$statistic <- lParts$statistic
  lPair$p_value <- lParts$p_value
  lPair$name <- names(lRun$value$estimate)
  lPair$estimate <- unname(lRun$value$estimate)
  # cor.test() gives an interval for Pearson only, and only from four pairs.
  if (!is.null(lRun$value$conf.int)) {
    lPair$lower <- lRun$value$conf.int[1]
    lPair$upper <- lRun$value$conf.int[2]
    lPair$level <- nConfLevel
  }
  lPair
}

Stat_NoIntervalNote <- function(strMethod) {
  if (strMethod == "spearman") {
    "cor.test() gives no confidence interval for Spearman's rho, so none is reported."
  } else {
    character(0)
  }
}

Analyze_Correlation <- function(dfData, strXCol, strYCol, strMethod = "pearson", strGroupCol = NULL,
                                chrGroups = NULL, nConfLevel = 0.95, nMinGroup = nMinGroupDefault) {
  Stat_Run(strMethod, function() {
    Stat_CheckData(dfData)
    Stat_CheckChoice(strMethod, c("pearson", "spearman"), "strMethod")
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinGroup, "nMinGroup", 0)
    nX <- Stat_Numeric(dfData, strXCol, "strXCol")
    nY <- Stat_Numeric(dfData, strYCol, "strYCol")
    bPair <- !is.na(nX) & !is.na(nY)
    chrReason <- "Incomplete pair"
    nDropped <- sum(!bPair)

    # Per group, when a group column is named. The overall answer uses every
    # complete pair, with or without a group.
    dfRows <- data.frame()
    chrWarnings <- character(0)
    if (!is.null(strGroupCol)) {
      chrGroup <- Stat_Category(dfData, strGroupCol, "strGroupCol")
      chrLevels <- Stat_Levels(chrGroup, chrGroups, "chrGroups")
      chrReason <- c(chrReason, "Missing group (left out of the per-group rows)", "Group not selected (left out of the per-group rows)")
      nDropped <- c(nDropped, sum(bPair & is.na(chrGroup)), sum(bPair & !is.na(chrGroup) & !chrGroup %in% chrLevels))
      nGroups <- length(chrLevels)
      dfRows <- data.frame(
        group = chrLevels, counts = NA_integer_, estimate = NA_real_, lower = NA_real_, upper = NA_real_,
        level = NA_real_, method = NA_character_, statistic = NA_real_, p_value = NA_real_,
        adjustment = "none", status = "ok", reason = NA_character_, warning = NA_character_,
        stringsAsFactors = FALSE
      )
      for (iGroup in seq_len(nGroups)) {
        bGroup <- !is.na(chrGroup) & chrGroup == chrLevels[iGroup]
        lGroup <- Stat_CorrelationPair(nX[bGroup], nY[bGroup], strMethod, nConfLevel, nMinGroup)
        dfRows$counts[iGroup] <- lGroup$counts
        dfRows$estimate[iGroup] <- lGroup$estimate
        dfRows$lower[iGroup] <- lGroup$lower
        dfRows$upper[iGroup] <- lGroup$upper
        dfRows$level[iGroup] <- lGroup$level
        dfRows$method[iGroup] <- lGroup$method
        dfRows$statistic[iGroup] <- if (nrow(lGroup$statistic) > 0L) lGroup$statistic$value[1] else NA_real_
        dfRows$p_value[iGroup] <- lGroup$p_value
        dfRows$status[iGroup] <- lGroup$status
        dfRows$reason[iGroup] <- lGroup$reason
        if (length(lGroup$warnings) > 0L) {
          dfRows$warning[iGroup] <- paste(unique(lGroup$warnings), collapse = "; ")
          chrWarnings <- c(chrWarnings, lGroup$warnings)
        }
      }
    }
    dfDropped <- Stat_Dropped(chrReason, nDropped)

    lAll <- Stat_CorrelationPair(nX, nY, strMethod, nConfLevel, nMinGroup)
    if (lAll$status != "ok") {
      return(Stat_Result(
        strTest = strMethod, strStatus = lAll$status, strReason = lAll$reason, xCounts = lAll$counts,
        dfDropped = dfDropped, chrWarnings = c(lAll$warnings, chrWarnings), dfRows = dfRows
      ))
    }
    Stat_Result(
      strTest = strMethod, strMethod = lAll$method,
      dfEstimates = Stat_Estimates(lAll$name, NA_character_, lAll$estimate, lAll$lower, lAll$upper, lAll$level),
      dfStatistic = lAll$statistic, nPValue = lAll$p_value, xCounts = lAll$counts, dfDropped = dfDropped,
      chrWarnings = c(lAll$warnings, chrWarnings), chrNotes = Stat_NoIntervalNote(strMethod), dfRows = dfRows
    )
  })
}

Analyze_CorrelationMatrix <- function(dfData, chrCols, strMethod = "pearson", nConfLevel = 0.95,
                                      nMinPairs = nMinGroupDefault) {
  Stat_Run(strMethod, function() {
    Stat_CheckData(dfData)
    Stat_CheckChoice(strMethod, c("pearson", "spearman"), "strMethod")
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinPairs, "nMinPairs", 0)
    chrCols <- Stat_Vector(chrCols, "chrCols")
    nCols <- length(chrCols)
    if (nCols < 2L) {
      stop("chrCols must name two or more columns.", call. = FALSE)
    }
    lValues <- lapply(chrCols, function(strCol) Stat_Numeric(dfData, strCol, "chrCols"))
    lCounts <- Stat_GroupCounts(chrCols, vapply(lValues, function(nCol) sum(!is.na(nCol)), integer(1)))

    # One row per pair of columns, each pair once, on that pair's complete rows.
    nPairs <- nCols * (nCols - 1L) / 2L
    iFirst <- rep(seq_len(nCols - 1L), times = rev(seq_len(nCols - 1L)))
    iSecond <- unlist(lapply(seq_len(nCols - 1L), function(iCol) seq(iCol + 1L, nCols)))
    dfRows <- data.frame(
      x = chrCols[iFirst], y = chrCols[iSecond], counts = NA_integer_, estimate = NA_real_,
      lower = NA_real_, upper = NA_real_, level = NA_real_, status = "ok", reason = NA_character_,
      warning = NA_character_, stringsAsFactors = FALSE
    )
    chrWarnings <- character(0)
    strMethodName <- NA_character_
    for (iPair in seq_len(nPairs)) {
      lPair <- Stat_CorrelationPair(
        lValues[[iFirst[iPair]]], lValues[[iSecond[iPair]]], strMethod, nConfLevel, nMinPairs
      )
      dfRows$counts[iPair] <- lPair$counts
      dfRows$estimate[iPair] <- lPair$estimate
      dfRows$lower[iPair] <- lPair$lower
      dfRows$upper[iPair] <- lPair$upper
      dfRows$level[iPair] <- lPair$level
      dfRows$status[iPair] <- lPair$status
      dfRows$reason[iPair] <- lPair$reason
      if (length(lPair$warnings) > 0L) {
        dfRows$warning[iPair] <- paste(unique(lPair$warnings), collapse = "; ")
        chrWarnings <- c(chrWarnings, lPair$warnings)
      }
      if (!is.na(lPair$method)) {
        strMethodName <- lPair$method
      }
    }

    bNone <- all(dfRows$status == "too_small")
    Stat_Result(
      strTest = strMethod,
      strStatus = if (bNone) "too_small" else "ok",
      strReason = if (bNone) {
        sprintf("Not computed: no pair of columns has %s complete pairs.", format(nMinPairs))
      } else {
        NA_character_
      },
      strMethod = strMethodName, xCounts = lCounts,
      chrWarnings = chrWarnings,
      chrNotes = c(
        "No p-values: a matrix reports each coefficient, its interval and its pair count. Use Analyze_Correlation() to test one pair.",
        Stat_NoIntervalNote(strMethod)
      ),
      dfRows = dfRows
    )
  })
}

# ---- Contingency ------------------------------------------------------------

Analyze_Contingency <- function(dfData, strRowCol, strColCol, strMethod = "chisq", chrRowGroups = NULL,
                                chrColGroups = NULL, nConfLevel = 0.95, nMinGroup = nMinGroupDefault) {
  Stat_Run(strMethod, function() {
    Stat_CheckData(dfData)
    Stat_CheckChoice(strMethod, c("chisq", "fisher"), "strMethod")
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinGroup, "nMinGroup", 0)
    chrRow <- Stat_Category(dfData, strRowCol, "strRowCol")
    chrCol <- Stat_Category(dfData, strColCol, "strColCol")
    chrRowLevels <- Stat_Levels(chrRow, chrRowGroups, "chrRowGroups")
    chrColLevels <- Stat_Levels(chrCol, chrColGroups, "chrColGroups")

    bMissing <- is.na(chrRow) | is.na(chrCol)
    bOther <- !bMissing & (!chrRow %in% chrRowLevels | !chrCol %in% chrColLevels)
    bUsed <- !bMissing & !bOther
    dfDropped <- Stat_Dropped(c("Missing category", "Category not selected"), c(sum(bMissing), sum(bOther)))

    # The two-way table of counts, as a plain matrix that never leaves here.
    mTable <- unclass(table(
      factor(chrRow[bUsed], levels = chrRowLevels),
      factor(chrCol[bUsed], levels = chrColLevels)
    ))
    dimnames(mTable) <- list(chrRowLevels, chrColLevels)
    nRowTotals <- rowSums(mTable)
    nColTotals <- colSums(mTable)
    nUsed <- as.integer(sum(mTable))
    dfRows <- data.frame(
      row = rep(chrRowLevels, times = length(chrColLevels)),
      col = rep(chrColLevels, each = length(chrRowLevels)),
      n = as.integer(mTable), expected = NA_real_, small_expected = NA,
      stringsAsFactors = FALSE
    )

    if (length(chrRowLevels) < 2L || length(chrColLevels) < 2L) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "error", xCounts = nUsed, dfDropped = dfDropped, dfRows = dfRows,
        strReason = sprintf(
          "A two-way table needs two or more categories each way; '%s' has %d and '%s' has %d.",
          strRowCol, length(chrRowLevels), strColCol, length(chrColLevels)
        )
      ))
    }
    chrMargin <- c(paste0(strRowCol, " = ", chrRowLevels), paste0(strColCol, " = ", chrColLevels))
    nMargin <- c(nRowTotals, nColTotals)
    if (any(nMargin < nMinGroup)) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "too_small", xCounts = nUsed, dfDropped = dfDropped, dfRows = dfRows,
        strReason = Stat_TooSmallReason(chrMargin, nMargin, nMinGroup)
      ))
    }

    lRun <- if (strMethod == "chisq") {
      Stat_Capture(function() stats::chisq.test(mTable))
    } else {
      Stat_Capture(function() stats::fisher.test(mTable, conf.level = nConfLevel))
    }
    if (!is.na(lRun$error)) {
      return(Stat_Result(
        strTest = strMethod, strStatus = "error", strReason = lRun$error, xCounts = nUsed,
        dfDropped = dfDropped, chrWarnings = lRun$warnings, dfRows = dfRows
      ))
    }
    lParts <- Stat_FromTest(lRun$value)
    dfEstimates <- Stat_Estimates()
    chrNotes <- character(0)
    if (strMethod == "chisq") {
      # The flag is read from the expected counts chisq.test() itself returns.
      dfRows$expected <- as.numeric(lRun$value$expected)
      dfRows$small_expected <- dfRows$expected < nSmallExpectedCount
      if (any(dfRows$small_expected)) {
        chrNotes <- sprintf(
          "%d of %d expected counts are below %s, so the chi-squared approximation may be poor. Fisher's exact test does not rely on it.",
          sum(dfRows$small_expected), nrow(dfRows), format(nSmallExpectedCount)
        )
      }
    } else if (!is.null(lRun$value$estimate)) {
      # fisher.test() estimates an odds ratio for a two-by-two table only.
      dfEstimates <- Stat_Estimates(
        names(lRun$value$estimate), NA_character_, unname(lRun$value$estimate),
        lRun$value$conf.int[1], lRun$value$conf.int[2], nConfLevel
      )
    }

    Stat_Result(
      strTest = strMethod, strMethod = lParts$method, dfEstimates = dfEstimates,
      dfStatistic = lParts$statistic, nPValue = lParts$p_value, xCounts = nUsed, dfDropped = dfDropped,
      chrWarnings = lRun$warnings, chrNotes = chrNotes, dfRows = dfRows
    )
  })
}

# ---- Survival ---------------------------------------------------------------

# Which rows are events. The caller names one column and, by which argument it
# uses, says which way round the column is: strCensorCol holds 1 for a censored
# time and 0 for an event, as ADaM's CNSR does; strEventCol holds 1 for an
# event and 0 for a censored time. A column holding anything else is refused,
# because it is probably not the column that was meant.
Stat_Events <- function(dfData, strCensorCol, strEventCol) {
  if (is.null(strCensorCol) == is.null(strEventCol)) {
    stop(
      "Name exactly one of strCensorCol (1 = censored, 0 = event, as ADaM's CNSR) and strEventCol (1 = event, 0 = censored).",
      call. = FALSE
    )
  }
  bCensor <- !is.null(strCensorCol)
  strCol <- if (bCensor) strCensorCol else strEventCol
  strArg <- if (bCensor) "strCensorCol" else "strEventCol"
  xCol <- Stat_Column(dfData, strCol, strArg)
  if (!is.numeric(xCol) && !is.logical(xCol)) {
    stop(sprintf("Column '%s' (%s) must hold only 0 and 1.", strCol, strArg), call. = FALSE)
  }
  nFlag <- as.numeric(xCol)
  if (any(!is.na(nFlag) & nFlag != 0 & nFlag != 1)) {
    stop(sprintf("Column '%s' (%s) must hold only 0 and 1.", strCol, strArg), call. = FALSE)
  }
  list(
    event = if (bCensor) nFlag == 0 else nFlag == 1,
    note = sprintf("An event is a row where %s is %d; the others are censored.", strCol, if (bCensor) 0L else 1L)
  )
}

Analyze_Survival <- function(dfData, strTimeCol, strGroupCol, strCensorCol = NULL, strEventCol = NULL,
                             chrGroups = NULL, nConfLevel = 0.95, nMinGroup = nMinGroupDefault) {
  Stat_Run("logrank", function() {
    Stat_CheckData(dfData)
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinGroup, "nMinGroup", 0)
    nTime <- Stat_Numeric(dfData, strTimeCol, "strTimeCol")
    lEvents <- Stat_Events(dfData, strCensorCol, strEventCol)
    chrGroup <- Stat_Category(dfData, strGroupCol, "strGroupCol")
    chrLevels <- Stat_Levels(chrGroup, chrGroups, "chrGroups")

    bNoGroup <- is.na(chrGroup)
    bOtherGroup <- !bNoGroup & !chrGroup %in% chrLevels
    bNoOutcome <- !bNoGroup & !bOtherGroup & (is.na(nTime) | is.na(lEvents$event))
    bNegative <- !bNoGroup & !bOtherGroup & !bNoOutcome & nTime < 0
    bUsed <- !bNoGroup & !bOtherGroup & !bNoOutcome & !bNegative
    dfDropped <- Stat_Dropped(
      c("Missing group", "Group not selected", "Missing time or event flag", "Negative time"),
      c(sum(bNoGroup), sum(bOtherGroup), sum(bNoOutcome), sum(bNegative))
    )
    nGroups <- length(chrLevels)
    nCounts <- vapply(chrLevels, function(strLevel) sum(bUsed & chrGroup == strLevel), integer(1))
    nEvents <- vapply(chrLevels, function(strLevel) sum(bUsed & chrGroup == strLevel & lEvents$event), integer(1))
    lCounts <- Stat_GroupCounts(chrLevels, nCounts)
    dfRows <- data.frame(
      group = chrLevels, n = unname(nCounts), events = unname(nEvents), median = NA_real_, lower = NA_real_,
      upper = NA_real_, level = NA_real_, hazard_ratio = NA_real_, hr_lower = NA_real_, hr_upper = NA_real_,
      hr_p_value = NA_real_, hr_test = NA_character_, stringsAsFactors = FALSE
    )

    if (nGroups < 2L) {
      return(Stat_Result(
        strTest = "logrank", strStatus = "error", xCounts = lCounts, dfDropped = dfDropped, dfRows = dfRows,
        strReason = sprintf("The log-rank test compares two or more groups and %d was found.", nGroups)
      ))
    }
    if (any(nCounts < nMinGroup)) {
      return(Stat_Result(
        strTest = "logrank", strStatus = "too_small", xCounts = lCounts, dfDropped = dfDropped, dfRows = dfRows,
        strReason = Stat_TooSmallReason(chrLevels, nCounts, nMinGroup)
      ))
    }

    # The rows used, in the order they came. The hazard ratio is the first
    # group's hazard over the second's, so the second group is the reference.
    dfModel <- data.frame(Group = factor(chrGroup[bUsed], levels = chrLevels))
    dfModel$Outcome <- survival::Surv(nTime[bUsed], lEvents$event[bUsed])
    lLogRank <- Stat_Capture(function() survival::survdiff(Outcome ~ Group, data = dfModel))
    lFit <- Stat_Capture(function() {
      summary(survival::survfit(Outcome ~ Group, data = dfModel, conf.type = "log-log", conf.int = nConfLevel))$table
    })
    chrWarnings <- c(lLogRank$warnings, lFit$warnings)
    chrErrors <- c(lLogRank$error, lFit$error)
    lCox <- NULL
    if (nGroups == 2L) {
      dfModel$Against <- factor(chrGroup[bUsed], levels = rev(chrLevels))
      lCox <- Stat_Capture(function() summary(survival::coxph(Outcome ~ Against, data = dfModel), conf.int = nConfLevel))
      chrWarnings <- c(chrWarnings, lCox$warnings)
      chrErrors <- c(chrErrors, lCox$error)
    }
    chrErrors <- chrErrors[!is.na(chrErrors)]
    if (length(chrErrors) > 0L) {
      return(Stat_Result(
        strTest = "logrank", strStatus = "error", strReason = paste(unique(chrErrors), collapse = "; "),
        xCounts = lCounts, dfDropped = dfDropped, chrWarnings = chrWarnings, dfRows = dfRows
      ))
    }

    # survdiff() reports its p-value from version 3.3 of survival; before that
    # it is the same upper tail of the chi-squared distribution, taken here.
    nChisq <- lLogRank$value$chisq
    nDf <- nGroups - 1L
    nPValue <- lLogRank$value$pvalue
    if (is.null(nPValue)) {
      nPValue <- stats::pchisq(nChisq, nDf, lower.tail = FALSE)
    }

    # The median columns of survfit()'s table: the median, then its interval.
    iMedian <- match("median", colnames(lFit$value))
    dfRows$median <- unname(lFit$value[, iMedian])
    dfRows$lower <- unname(lFit$value[, iMedian + 1L])
    dfRows$upper <- unname(lFit$value[, iMedian + 2L])
    dfRows$level <- nConfLevel
    dfEstimates <- Stat_Estimates(
      rep("Median", nGroups), chrLevels, dfRows$median, dfRows$lower, dfRows$upper, nConfLevel
    )
    chrNotes <- c(
      lEvents$note,
      "The medians and their intervals are survfit()'s, with the log-log interval (conf.type = 'log-log')."
    )
    if (anyNA(dfRows$median) || anyNA(dfRows$lower) || anyNA(dfRows$upper)) {
      chrNotes <- c(chrNotes, "A missing median or bound was not reached: the curve, or its band, did not fall to one half.")
    }
    if (nGroups == 2L) {
      dfRows$hazard_ratio[1] <- unname(lCox$value$conf.int[1, 1])
      dfRows$hr_lower[1] <- unname(lCox$value$conf.int[1, 3])
      dfRows$hr_upper[1] <- unname(lCox$value$conf.int[1, 4])
      dfRows$hr_p_value[1] <- unname(lCox$value$coefficients[1, 5])
      dfRows$hr_test[1] <- "Wald"
      dfEstimates <- rbind(dfEstimates, Stat_Estimates(
        "Hazard ratio", paste(chrLevels[1], "/", chrLevels[2]),
        dfRows$hazard_ratio[1], dfRows$hr_lower[1], dfRows$hr_upper[1], nConfLevel
      ))
      chrNotes <- c(chrNotes, sprintf(
        "The hazard ratio is coxph()'s: the hazard in %s over the hazard in %s. p_value is the log-rank test's; the hazard ratio's interval and hr_p_value in rows are the Cox model's Wald test's, a different test.",
        chrLevels[1], chrLevels[2]
      ))
    }

    Stat_Result(
      # survdiff() has no name for itself; this one is ours.
      strTest = "logrank", strMethod = "Log-rank test", dfEstimates = dfEstimates,
      dfStatistic = Stat_Statistic(c("Chisq", "df"), c(nChisq, nDf)), nPValue = nPValue, xCounts = lCounts,
      dfDropped = dfDropped, chrWarnings = chrWarnings, chrNotes = chrNotes, dfRows = dfRows
    )
  })
}

# ---- Screen -----------------------------------------------------------------

# The standardised difference between two groups: Hedges' g, the difference in
# means over the pooled standard deviation, times the small-sample correction.
# The interval is the noncentral t interval for the two-sample t statistic,
# put on the same scale. This is the one statistic written here rather than
# handed to an existing function.
Stat_StandardisedDifference <- function(nFirst, nSecond, nConfLevel) {
  nOne <- length(nFirst)
  nTwo <- length(nSecond)
  nDf <- nOne + nTwo - 2
  nPooled <- sqrt(((nOne - 1) * stats::var(nFirst) + (nTwo - 1) * stats::var(nSecond)) / nDf)
  nScale <- sqrt(1 / nOne + 1 / nTwo)
  nT <- (mean(nFirst) - mean(nSecond)) / (nPooled * nScale)
  nCorrection <- exp(lgamma(nDf / 2) - log(sqrt(nDf / 2)) - lgamma((nDf - 1) / 2))
  if (!is.finite(nT)) {
    stop("The standardised difference is not defined: the values do not vary.", call. = FALSE)
  }
  # The noncentrality at which the observed t sits at a given probability.
  Limit <- function(nProbability) {
    stats::uniroot(
      function(nNoncentrality) stats::pt(nT, nDf, ncp = nNoncentrality) - nProbability,
      interval = nT + c(-1, 1) * (stats::qnorm(1 - (1 - nConfLevel) / 4) + 1) * sqrt(1 + nT^2 / (2 * nDf)),
      extendInt = "downX", tol = 1e-10
    )$root
  }
  list(
    estimate = nT * nScale * nCorrection,
    lower = Limit(1 - (1 - nConfLevel) / 2) * nScale * nCorrection,
    upper = Limit((1 - nConfLevel) / 2) * nScale * nCorrection
  )
}

Analyze_Screen <- function(dfData, chrCols, strComparison = "difference", strGroupCol = NULL, chrGroups = NULL,
                           strWithCol = NULL, strCorMethod = "pearson", strTimeCol = NULL, strCensorCol = NULL,
                           strEventCol = NULL, strPAdjust = "BH", nConfLevel = 0.95,
                           nMinGroup = nMinGroupDefault) {
  Stat_Run(strComparison, function() {
    Stat_CheckData(dfData)
    Stat_CheckChoice(strComparison, c("difference", "correlation", "hazard"), "strComparison")
    Stat_CheckChoice(strPAdjust, stats::p.adjust.methods, "strPAdjust")
    Stat_CheckNumber(nConfLevel, "nConfLevel", 0, 1)
    Stat_CheckNumber(nMinGroup, "nMinGroup", 0)
    chrCols <- Stat_Vector(chrCols, "chrCols")
    if (is.null(chrCols)) {
      stop("chrCols must name one or more columns.", call. = FALSE)
    }
    nRows <- length(chrCols)
    dfRows <- data.frame(
      biomarker = chrCols, counts = NA_integer_, n_1 = NA_integer_, n_2 = NA_integer_, events = NA_integer_,
      dropped = NA_integer_, estimate = NA_real_, lower = NA_real_, upper = NA_real_, level = NA_real_,
      method = NA_character_, statistic = NA_real_, p_unadjusted = NA_real_, p_value = NA_real_,
      adjustment = strPAdjust, adjusted_over = NA_integer_, status = "ok", reason = NA_character_,
      warning = NA_character_, stringsAsFactors = FALSE
    )
    chrWarnings <- character(0)

    # What each comparison needs, checked once, before any row is computed.
    if (strComparison == "difference") {
      chrGroup <- Stat_Category(dfData, strGroupCol, "strGroupCol")
      chrLevels <- Stat_Levels(chrGroup, chrGroups, "chrGroups")
      if (length(chrLevels) != 2L) {
        stop(sprintf(
          "A standardised difference compares exactly two groups and %d were found. Name two in chrGroups.",
          length(chrLevels)
        ), call. = FALSE)
      }
      strEstimate <- sprintf("Standardised difference (Hedges' g), %s - %s", chrLevels[1], chrLevels[2])
    } else if (strComparison == "correlation") {
      Stat_CheckChoice(strCorMethod, c("pearson", "spearman"), "strCorMethod")
      Stat_Numeric(dfData, strWithCol, "strWithCol")
      strEstimate <- sprintf("Correlation with %s", strWithCol)
    } else {
      nTime <- Stat_Numeric(dfData, strTimeCol, "strTimeCol")
      lEvents <- Stat_Events(dfData, strCensorCol, strEventCol)
      strEstimate <- "Hazard ratio, High / Low"
    }

    for (iRow in seq_len(nRows)) {
      strCol <- chrCols[iRow]
      # Every row is the matching single function's own answer for that
      # biomarker, so its p-value is the one the single chart prints.
      lRow <- if (strComparison == "difference") {
        Analyze_GroupDifference(
          dfData, strCol, strGroupCol,
          strMethod = "t", chrGroups = chrLevels, nConfLevel = nConfLevel, nMinGroup = nMinGroup
        )
      } else if (strComparison == "correlation") {
        Analyze_Correlation(
          dfData, strCol, strWithCol,
          strMethod = strCorMethod, nConfLevel = nConfLevel, nMinGroup = nMinGroup
        )
      } else {
        # High and low are the two sides of the median of the biomarker among
        # the rows that can be used; a value on the median is low.
        lValue <- Stat_Capture(function() Stat_Numeric(dfData, strCol, "chrCols"))
        if (is.na(lValue$error)) {
          bUsable <- !is.na(lValue$value) & !is.na(nTime) & nTime >= 0 & !is.na(lEvents$event)
          nMedian <- stats::median(lValue$value[bUsable])
          dfSplit <- data.frame(
            Time = nTime, Event = as.integer(lEvents$event),
            Level = ifelse(is.na(lValue$value), NA_character_, ifelse(lValue$value > nMedian, "High", "Low")),
            stringsAsFactors = FALSE
          )
          Analyze_Survival(
            dfSplit, "Time", "Level",
            strEventCol = "Event", chrGroups = c("High", "Low"), nConfLevel = nConfLevel, nMinGroup = nMinGroup
          )
        } else {
          Stat_Result(strTest = "logrank", strStatus = "error", strReason = lValue$error)
        }
      }

      dfRows$status[iRow] <- lRow$status
      dfRows$reason[iRow] <- lRow$reason
      dfRows$dropped[iRow] <- sum(lRow$dropped$n)
      if (is.list(lRow$counts)) {
        dfRows$n_1[iRow] <- lRow$counts[[1]]
        dfRows$n_2[iRow] <- lRow$counts[[2]]
        dfRows$counts[iRow] <- lRow$counts[[1]] + lRow$counts[[2]]
      } else {
        dfRows$counts[iRow] <- lRow$counts
      }
      chrRowWarnings <- unlist(lRow$warnings)
      if (lRow$status == "ok") {
        dfRows$method[iRow] <- lRow$method
        dfRows$statistic[iRow] <- lRow$statistic$value[1]
        dfRows$p_unadjusted[iRow] <- lRow$p_value
        if (strComparison == "difference") {
          lSplit <- Stat_SplitByGroup(Stat_Numeric(dfData, strCol, "chrCols"), chrGroup, chrLevels)
          lEffect <- Stat_Capture(function() {
            Stat_StandardisedDifference(lSplit$values[[1]], lSplit$values[[2]], nConfLevel)
          })
          chrRowWarnings <- c(chrRowWarnings, lEffect$warnings)
          if (is.na(lEffect$error)) {
            dfRows$estimate[iRow] <- lEffect$value$estimate
            dfRows$lower[iRow] <- lEffect$value$lower
            dfRows$upper[iRow] <- lEffect$value$upper
            dfRows$level[iRow] <- nConfLevel
          } else {
            dfRows$status[iRow] <- "error"
            dfRows$reason[iRow] <- lEffect$error
            dfRows$p_unadjusted[iRow] <- NA_real_
          }
        } else {
          # The last estimate is the one the screen is about: the coefficient,
          # or the hazard ratio after the two medians.
          dfLast <- lRow$estimates[nrow(lRow$estimates), ]
          dfRows$estimate[iRow] <- dfLast$estimate
          dfRows$lower[iRow] <- dfLast$lower
          dfRows$upper[iRow] <- dfLast$upper
          dfRows$level[iRow] <- dfLast$level
          if (strComparison == "hazard") {
            dfRows$events[iRow] <- sum(lRow$rows$events)
          }
        }
      }
      if (length(chrRowWarnings) > 0L) {
        dfRows$warning[iRow] <- paste(unique(chrRowWarnings), collapse = "; ")
        chrWarnings <- c(chrWarnings, chrRowWarnings)
      }
    }

    # Adjust across the rows that have a p-value; the others are not tests.
    bTested <- !is.na(dfRows$p_unadjusted)
    dfRows$p_value[bTested] <- stats::p.adjust(dfRows$p_unadjusted[bTested], method = strPAdjust)
    dfRows$adjusted_over[bTested] <- sum(bTested)

    bAny <- any(dfRows$status == "ok")
    bAllSmall <- all(dfRows$status == "too_small")
    chrNotes <- c(
      sprintf("Each row's estimate: %s.", strEstimate),
      sprintf(
        "p_value is adjusted across the %d rows that have a p-value by p.adjust(method = '%s'); %d of the %d rows have none and are left out of the adjustment.",
        sum(bTested), strPAdjust, sum(!bTested), nRows
      ),
      if (strComparison == "difference") {
        "The p-values are t.test()'s (Welch). The standardised difference and its interval are computed here, not by an existing function."
      } else if (strComparison == "correlation") {
        Stat_NoIntervalNote(strCorMethod)
      } else {
        c(
          lEvents$note,
          "High and low are the two sides of each biomarker's median among the rows used; a value on the median is low. The p-values are the log-rank test's and the intervals are the Cox model's."
        )
      }
    )
    Stat_Result(
      strTest = strComparison,
      strStatus = if (bAny) "ok" else if (bAllSmall) "too_small" else "error",
      strReason = if (bAny) {
        NA_character_
      } else if (bAllSmall) {
        "Not computed: every biomarker has a group below the minimum size. Each row gives its reason."
      } else {
        "No biomarker could be computed. Each row gives its reason."
      },
      strMethod = if (bAny) dfRows$method[dfRows$status == "ok"][1] else NA_character_,
      xCounts = Stat_GroupCounts(chrCols, dfRows$counts),
      chrWarnings = chrWarnings, chrNotes = chrNotes, dfRows = dfRows
    )
  })
}
