# The order a two-way chart draws a column's categories in, and hands them to R
# in: the cross-tabulation's rows and columns (src/cross-tab/structureData.js)
# and the stratified survival chart's groups (src/stratified-survival/
# structureData.js), both by `categoryOrder` in src/shared/tables.js. Sourced
# by tools/r-cross-tab.R and tools/r-survival.R from the repository root; it
# defines functions and runs nothing.
#
# It is gsm.bio's own order, Core_NaturalCompare in gsm.bio's R/core.R (dev at
# 7200def), copied here so that the recipes, and any table gsm.bio writes
# stored results for, order the levels as the chart draws and sends them: by
# name, with numbers inside a name counted as numbers ("2 mg" before "10 mg",
# "Week 2" before "Week 10"), the letters A to Z read as a to z, and anything
# else compared by its code point, the same in every session and every browser
# language. A digit sorts before a
# letter (any non-ASCII character counts as one) and after a space or
# punctuation. Names that differ only in case put lower case first.

order_utf8 <- function(chrText) {
  bLatin1 <- !is.na(chrText) & Encoding(chrText) == "latin1"
  chrText[bLatin1] <- enc2utf8(chrText[bLatin1])
  chrText
}

order_bytes <- function(strText) charToRaw(order_utf8(strText))

order_compare_bytes <- function(rawFirst, rawSecond) {
  nShared <- min(length(rawFirst), length(rawSecond))
  if (nShared > 0L) {
    nDifference <- as.integer(rawFirst[seq_len(nShared)]) - as.integer(rawSecond[seq_len(nShared)])
    iAt <- which(nDifference != 0L)
    if (length(iAt) > 0L) return(sign(nDifference[iAt[1L]]))
  }
  sign(length(rawFirst) - length(rawSecond))
}

natural_compare <- function(strFirst, strSecond) {
  Parts <- function(strText) {
    regmatches(strText, gregexpr("[0-9]+|[^0-9]+", strText, useBytes = TRUE))[[1]]
  }
  Lower <- function(rawText) {
    bUpper <- rawText >= as.raw(0x41) & rawText <= as.raw(0x5a)
    rawText[bUpper] <- as.raw(as.integer(rawText[bUpper]) + 32L)
    rawText
  }
  IsDigits <- function(strPart) grepl("^[0-9]", strPart, useBytes = TRUE)
  IsLetter <- function(strPart) {
    rawFirst <- order_bytes(strPart)[1L]
    grepl("^[A-Za-z]", strPart, useBytes = TRUE) || rawFirst >= as.raw(0x80)
  }
  chrFirst <- Parts(order_utf8(strFirst))
  chrSecond <- Parts(order_utf8(strSecond))
  for (iPart in seq_len(min(length(chrFirst), length(chrSecond)))) {
    strA <- chrFirst[iPart]
    strB <- chrSecond[iPart]
    bDigitsA <- IsDigits(strA)
    bDigitsB <- IsDigits(strB)
    if (bDigitsA && bDigitsB) {
      nDifference <- as.numeric(strA) - as.numeric(strB)
      if (nDifference != 0) return(sign(nDifference))
    } else if (bDigitsA != bDigitsB) {
      iSign <- if (IsLetter(if (bDigitsA) strB else strA)) -1 else 1
      return(if (bDigitsA) iSign else -iSign)
    } else {
      iOrder <- order_compare_bytes(Lower(order_bytes(strA)), Lower(order_bytes(strB)))
      if (iOrder != 0) return(iOrder)
    }
  }
  if (length(chrFirst) != length(chrSecond)) return(sign(length(chrFirst) - length(chrSecond)))
  -order_compare_bytes(order_bytes(strFirst), order_bytes(strSecond))
}

# Sorts names with the comparison, keeping the order of names that compare equal.
natural_sort <- function(chrNames) {
  chrNames <- as.character(chrNames)
  for (iNext in seq_along(chrNames)[-1]) {
    strNext <- chrNames[iNext]
    iAt <- iNext - 1L
    while (iAt >= 1L && natural_compare(chrNames[iAt], strNext) > 0) {
      chrNames[iAt + 1L] <- chrNames[iAt]
      iAt <- iAt - 1L
    }
    chrNames[iAt + 1L] <- strNext
  }
  chrNames
}

# Names whose order turns on each rule, for the unit test that holds the chart's
# order to this one: numbers in names, case, a letter outside ASCII, leading
# zeros, punctuation and spaces beside digits.
order_samples <- c(
  "Week 10", "week 1", "Week 2", "Ödem", "Edema", "10 mg", "2 mg", "02 mg", "B", "a", "b",
  "A", "Arm 2", "Arm-2", "Arm 10", "arm 2", "2", "10", "-1", "x1", "x 1", "Z", "état"
)
