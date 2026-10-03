// Pages of a long list: what one page holds, and how many it shows of how many,
// in words. The group comparison chart's overview pages its biomarkers this way
// and the biomarker screen its rows.
//
// Pure functions: no page and no chart.

/**
 * The items one page holds: at most `limit` of them, in the order given. A page
 * that does not exist is brought back to the nearest that does.
 * @param {Array} items Every item, in order.
 * @param {number} limit The most items on a page.
 * @param {number} [page=0] The page asked for, counted from zero.
 * @returns {{items: Array, page: number, pages: number, from: number, to: number,
 *   total: number}} The page's items, which page it is of how many, and the
 *   first and last of them counted from one.
 */
export function pageOf(items, limit, page = 0) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const at = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), pages - 1);
  const shown = items.slice(at * limit, (at + 1) * limit);
  return {
    items: shown,
    page: at,
    pages,
    from: total ? at * limit + 1 : 0,
    to: at * limit + shown.length,
    total
  };
}

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
};

/**
 * How many biomarkers a page shows, of how many, in words.
 * @param {{from: number, to: number, total: number, pages: number}} page A page, as `pageOf` gives it.
 * @param {string} order The order they are in, as the end of a sentence:
 *   `in the Biomarker control’s order`.
 * @returns {string} A sentence.
 */
export function pageCount({ from, to, total, pages }, order) {
  if (!total) return 'No biomarker to show.';
  if (pages === 1) {
    return total === 1 ? 'The one biomarker is shown.' : `All ${total} biomarkers are shown.`;
  }
  const which = from === to ? `the ${ordinal(from)}` : `${from} to ${to}`;
  return `${to - from + 1} of ${total} biomarkers shown: ${which}, ${order}.`;
}
