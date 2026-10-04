// The stratified survival chart's demo: the chart, on the synthetic study,
// opening on event-free survival by CRP at Baseline cut at its median, with R
// attached, in this browser. The study was planted with a survival effect of
// CRP: participants with high CRP at Baseline have the worse event-free
// survival. The Groups control offers the study's category columns and, cut at
// its median or its tertiles, CRP at Baseline; the cut line on the histogram
// can be dragged.
//
// What the page sets is kept on `BioVizDemo.stratifiedSurvival`, where a script
// can read it without a page.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var demo = (window.BioVizDemo.stratifiedSurvival = {
    settings: {
      endpoint: 'EFS',
      group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
      baseline_visits: 'Baseline',
      groups: labelled,
      filters: labelled,
      // Cut biomarkers the Groups control offers beside the columns.
      cuts: [{ measure: 'CRP', visit: 'Baseline', cut: 'tertiles' }],
      studyday_col: 'DAY',
      // What the first test costs on this page, said while R starts.
      waiting_note:
        'The first test starts R in this browser and installs the survival package: about 16 MB to download, once, and a few seconds.'
    },
    // R in the browser, given gsm.bio's statistics functions as vendored, and
    // the survival package, which its survival test calls.
    browser: { sourceUrl: '../vendor/gsm.bio/statistics.R', packages: ['survival'] },
    megabytes: 16,
    tables: function (study, outcomes) {
      return { results: study.results, participants: study.participants, outcomes: outcomes };
    }
  });

  // Read by a script, with no page and no chart to draw.
  if (!window.BioViz || !window.document) return;

  var folder = '../data/synthetic-study/';
  window.BioVizDemo.ready = Promise.all([
    window.BioVizDemo.loadStudy(folder),
    window.BioVizDemo.loadOutcomes(folder)
  ]).then(function (loaded) {
    // Making the connection fetches nothing. R is started when the curves are
    // first tested, which is when they are first drawn.
    var connection = window.BioViz.r.createConnection({ browser: demo.browser });
    var chart = window.BioViz.stratifiedSurvival(
      '#chart',
      Object.assign({}, demo.settings, { connection: connection })
    );
    window.BioVizDemo.chart = chart;
    return chart.init(demo.tables(loaded[0], loaded[1]));
  });
})();
