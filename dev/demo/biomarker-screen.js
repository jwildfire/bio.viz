// The biomarker screen's demo: the chart, on the synthetic study, opening on
// the difference the study was planted with: every biomarker's change from
// Baseline to Week 4, Placebo against Treatment, with R attached, in this
// browser. One biomarker was planted with a difference between the arms,
// IL-6; the rest differ by chance alone. With the study's outcomes table the
// screen also offers a hazard ratio, high against low, on event-free survival:
// CRP at Baseline was planted with the survival effect. A row opens that
// biomarker in the group comparison, the association scatter, or, for a hazard
// ratio, the stratified survival chart.
//
// What the page sets is kept on `BioVizDemo.biomarkerScreen`, where a script can
// read it without a page: tools/derive-screen-statistics.mjs reads the settings
// and the tables from here to write the frames desktop R is run on, so the
// expected results are for this chart and no other.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var numbers = [
    { value_col: 'AGE', label: 'Age' },
    { value_col: 'BMIBL', label: 'BMI at baseline' }
  ];
  var demo = (window.BioVizDemo.biomarkerScreen = {
    settings: {
      // The planted difference: IL-6's change from Baseline to Week 4 between arms.
      comparison: 'difference',
      visit: 'Week 4',
      value_type: 'change',
      group_by: 'ARM',
      baseline_visits: 'Baseline',
      groups: labelled,
      numbers: numbers,
      filters: labelled,
      // What the chart a row opens is given, beside what the screen carries over.
      group_comparison: { groups: labelled, studyday_col: 'DAY' },
      association_scatter: {
        groups: labelled,
        numbers: numbers,
        profile_details: labelled.concat([{ value_col: 'AGE', label: 'Age' }]),
        studyday_col: 'DAY'
      },
      stratified_survival: { groups: labelled, studyday_col: 'DAY' },
      // What the first screen costs on this page, said while R starts. The
      // megabytes are the ones the browser tests measure (BS-LIVE-006).
      waiting_note:
        'The first screen starts R in this browser and installs the survival package: about 26 MB to download, once, and a few seconds.'
    },
    // R in the browser, given gsm.bio's statistics functions as vendored, and
    // the survival package, which the hazard ratio calls.
    browser: { sourceUrl: '../vendor/gsm.bio/statistics.R', packages: ['survival'] },
    megabytes: 26,
    tables: function (study, outcomes) {
      var tables = { results: study.results, participants: study.participants };
      if (outcomes) tables.outcomes = outcomes;
      return tables;
    }
  });

  // Read by a script, with no page and no chart to draw.
  if (!window.BioViz || !window.document) return;

  var folder = '../data/synthetic-study/';
  window.BioVizDemo.ready = Promise.all([
    window.BioVizDemo.loadStudy(folder),
    window.BioVizDemo.loadOutcomes(folder)
  ]).then(function (loaded) {
    // Making the connection fetches nothing. R is started when the screen
    // first asks for its rows, which is when it is first drawn.
    var connection = window.BioViz.r.createConnection({ browser: demo.browser });
    var chart = window.BioViz.biomarkerScreen(
      '#chart',
      Object.assign({}, demo.settings, { connection: connection })
    );
    window.BioVizDemo.chart = chart;
    return chart.init(demo.tables(loaded[0], loaded[1]));
  });
})();
