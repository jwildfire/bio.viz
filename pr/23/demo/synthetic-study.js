// Reads the synthetic study for a demo page: the vendored CSV files, as arrays
// of records. Defines one global, `BioVizDemo`.
//
// The files hold no quoted field (the vendoring check refuses one), so a split
// is a read. Every value is text, as a page that reads a CSV file has it.
//
// One column is added to the results rows, for safety.viz's participant
// profile, whose time axis is a study day: `DAY`. The study gives each visit as
// a week number (VISITNUM: 0, 2, 4, 8, 12), and DAY is that number times seven.
// It is the planned day of the visit, worked out here, not a column of the
// study.
//
// `withArmSex` adds one column to the participant rows, for a page that wants a
// category with more than two levels: `ARM_SEX`, the participant's arm and sex
// joined by a space ("Placebo F"). Every category of the study has two levels,
// and a comparison of several groups needs more. Nothing is cut or estimated:
// the column is two of the study's own columns, side by side.
(function () {
  function parse(text) {
    var lines = text.replace(/\n$/, '').split('\n');
    var columns = lines[0].split(',');
    return lines.slice(1).map(function (line) {
      var cells = line.split(',');
      var record = {};
      columns.forEach(function (column, index) {
        record[column] = cells[index];
      });
      return record;
    });
  }

  function read(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(url + ' answered ' + response.status);
      return response.text().then(parse);
    });
  }

  function withDay(rows) {
    return rows.map(function (row) {
      return Object.assign({}, row, { DAY: String(Number(row.VISITNUM) * 7) });
    });
  }

  function withArmSex(rows) {
    return rows.map(function (row) {
      return Object.assign({}, row, { ARM_SEX: row.ARM + ' ' + row.SEX });
    });
  }

  window.BioVizDemo = {
    parse: parse,
    read: read,
    withDay: withDay,
    withArmSex: withArmSex,
    // `folder` is where the study is served from, with its closing slash.
    loadStudy: function (folder) {
      return Promise.all([
        read(folder + 'synthetic_results.csv'),
        read(folder + 'synthetic_participants.csv')
      ]).then(function (tables) {
        return { results: withDay(tables[0]), participants: tables[1] };
      });
    }
  };
})();
