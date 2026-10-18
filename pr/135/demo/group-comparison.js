// The group comparison chart's demo: the chart, on the synthetic study, opening
// on a tile for every biomarker, a line per arm across the visits, with R
// attached, in this browser. A tile opens its biomarker across the visits, with
// a row of tests under them, and R is started then, the first time a test is
// asked for. A visit's name opens that visit alone. IL-6 is the biomarker the
// study was planted with: its change from Baseline to Week 4 differs between
// the arms.
//
// What the page sets is kept on `BioVizDemo.groupComparison`, where a script can
// read it without a page: tools/derive-group-statistics.mjs reads the settings
// and the tables from here to write the rows desktop R is run on, so the
// expected results are for this chart and no other.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var demo = (window.BioVizDemo.groupComparison = {
    settings: {
      // What the figure is called, filled from the view drawn (#66).
      title: '{value}: {measure} by {group}',
      subtitle: 'At {visits}',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ],
      // No biomarker and no visit named: the tiles, at every visit.
      start_value: null,
      visits: null,
      // The result itself, so that the baseline visit is tested like the rest;
      // a change from baseline is one choice away in the Value control.
      value_type: 'raw',
      baseline_visits: 'Baseline',
      group_by: 'ARM',
      // Arm and sex together make four groups: the study's own categories have
      // two levels each, and the tests of several groups need more.
      groups: labelled.concat([{ value_col: 'ARM_SEX', label: 'Arm and sex' }]),
      filters: labelled,
      profile_details: labelled.concat([{ value_col: 'AGE', label: 'Age' }]),
      // The participant profile's time axis; see synthetic-study.js.
      studyday_col: 'DAY',
      // What the first test costs on this page, said while R starts: under the
      // row of tests, the first time a biomarker is opened. The megabytes are
      // the ones the browser tests measure (GC-STAT-041).
      waiting_note:
        'The first test starts R in this browser: about 13 MB to download, once, and a few seconds.'
    },
    // R in the browser. The one file it is given is gsm.bio's statistics
    // functions, as vendored. The file is sourced with base R alone: it names
    // the survival package only inside its survival functions, which this chart
    // never calls, so that package is not installed and its megabytes are not
    // downloaded.
    browser: { sourceUrl: '../vendor/gsm.bio/statistics.R', packages: [] },
    megabytes: 13,
    tables: function (study) {
      return {
        results: study.results,
        participants: window.BioVizDemo.withArmSex(study.participants)
      };
    }
  });

  // Read by a script, with no page and no chart to draw.
  if (!window.BioViz || !window.document) return;

  window.BioVizDemo.ready = window.BioVizDemo.loadStudy('../data/synthetic-study/').then(
    function (study) {
      // Making the connection fetches nothing. R is started the first time the
      // chart asks for a test: the tiles this page opens on print none, so R
      // starts when a biomarker is opened.
      var connection = window.BioViz.r.createConnection({ browser: demo.browser });
      var chart = window.BioViz.groupComparison(
        '#chart',
        Object.assign({}, demo.settings, { connection: connection })
      );
      window.BioVizDemo.chart = chart;
      return chart.init(demo.tables(study));
    }
  );
})();
