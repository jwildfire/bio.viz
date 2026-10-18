// The cross-tabulation's demo: the chart, on the synthetic study, opening on
// arm by response, with R attached, in this browser. The Rows and Columns
// controls offer the study's category columns and, cut at its median, CRP at
// Baseline; the Test control chooses between chi-square and Fisher's exact test.
//
// What the page sets is kept on `BioVizDemo.crossTab`, where a script can read
// it without a page.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var demo = (window.BioVizDemo.crossTab = {
    settings: {
      // What the figure is called, filled from the view drawn (#66).
      title: '{rows} by {columns}',
      subtitle: '{n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ],
      row_by: 'ARM',
      col_by: 'RESPONSE',
      percent: 'row',
      test: 'chisq',
      baseline_visits: 'Baseline',
      groups: labelled,
      filters: labelled,
      // A cut biomarker the Rows and Columns controls offer beside the columns.
      cuts: [{ measure: 'CRP', visit: 'Baseline', cut: 'median' }],
      studyday_col: 'DAY',
      // What the first test costs on this page, said while R starts.
      waiting_note:
        'The first test starts R in this browser: about 13 MB to download, once, and a few seconds.'
    },
    // R in the browser, given gsm.bio's statistics functions as vendored. The
    // file is sourced with base R alone, so no R package is installed.
    browser: { sourceUrl: '../vendor/gsm.bio/statistics.R', packages: [] },
    megabytes: 13,
    tables: function (study) {
      return { results: study.results, participants: study.participants };
    }
  });

  // Read by a script, with no page and no chart to draw.
  if (!window.BioViz || !window.document) return;

  window.BioVizDemo.ready = window.BioVizDemo.loadStudy('../data/synthetic-study/').then(
    function (study) {
      // Making the connection fetches nothing. R is started when the table is
      // first tested, which is when it is first drawn.
      var connection = window.BioViz.r.createConnection({ browser: demo.browser });
      var chart = window.BioViz.crossTab(
        '#chart',
        Object.assign({}, demo.settings, { connection: connection })
      );
      window.BioVizDemo.chart = chart;
      return chart.init(demo.tables(study));
    }
  );
})();
