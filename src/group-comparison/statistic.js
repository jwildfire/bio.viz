// The statistics line: what the chart prints under a panel about the groups it
// drew. The chart computes none of it. It asks R, through the connection, and
// prints what comes back through the one formatter every chart uses.
//
// Two rules are kept here, because a wrong number under a chart is worse than
// none:
//
//   - The line says it is waiting from the moment a result is asked for until
//     that result arrives.
//   - A result is shown only if nothing has been drawn since it was asked for.
//     Every render begins a new round, and an answer to an earlier round is
//     dropped when it arrives, however late.

export const WAITING = 'Statistics: waiting for R…';

// What one answer from the connection reads as on the line.
export function describeAnswer(result, formatStatistic) {
  if (result && result.status === 'ok') {
    const formatted = formatStatistic(result.value);
    return { state: formatted.status, text: formatted.text };
  }
  if (result && result.status === 'unavailable') {
    return { state: 'unavailable', text: result.message };
  }
  const message = result && typeof result.message === 'string' ? result.message : 'no message';
  return { state: 'error', text: `R reported an error: ${message}` };
}

/**
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {Function} parts.formatStatistic The shared formatter.
 * @returns {{begin: Function}} `begin()` starts a round and ends every earlier
 *   one; the round's `ask(request, show)` asks R and calls `show({ state,
 *   text })` at once with the waiting state, and again with the answer if the
 *   round is still the current one. It resolves to whether the answer was shown.
 */
export function createStatisticDesk({ connection, formatStatistic }) {
  let current = 0;
  return {
    begin() {
      current += 1;
      const round = current;
      return {
        ask({ name, data, args, dataId }, show) {
          show({ state: 'waiting', text: WAITING });
          return connection.run(name, { data, args, dataId }).then((result) => {
            if (round !== current) return false;
            show(describeAnswer(result, formatStatistic));
            return true;
          });
        }
      };
    }
  };
}
