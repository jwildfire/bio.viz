// The correlation matrix's demo: the chart, on the synthetic study, opening on
// every biomarker at the first visit, Baseline, with R attached, in this
// browser. One pair of the twelve was planted with a correlation, TNF-alpha
// with IL-10, true Pearson coefficient 0.6; the rest are unrelated by
// construction. A cell opens that pair in the association scatter.
//
// What the page sets is kept on `BioVizDemo.correlationMatrix`, where a script
// can read it without a page: tools/derive-matrix-statistics.mjs reads the
// settings and the tables from here to write the frames desktop R is run on, so
// the expected results are for this chart and no other.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var demo = (window.BioVizDemo.correlationMatrix = {
    settings: {
      // What the figure is called, filled from the view drawn (#66).
      title: '{heading}',
      subtitle: '{variables} variables, {n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ],
      // No mode, visit or biomarker named: every biomarker the limit allows, at
      // the first visit.
      baseline_visits: 'Baseline',
      filters: labelled,
      // What the association scatter is given when a cell opens it, beside the
      // pair, the method, the filters and the connection the grid carries over.
      scatter: {
        groups: labelled,
        numbers: [
          { value_col: 'AGE', label: 'Age' },
          { value_col: 'BMIBL', label: 'BMI at baseline' }
        ],
        profile_details: labelled.concat([{ value_col: 'AGE', label: 'Age' }]),
        studyday_col: 'DAY'
      },
      // What the first grid costs on this page, said while R starts. The
      // megabytes are the ones the browser tests measure (CM-LIVE-007).
      waiting_note:
        'The first grid starts R in this browser: about 13 MB to download, once, and a few seconds.'
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
      // Making the connection fetches nothing. R is started when the grid first
      // asks for its coefficients, which is when it is first drawn.
      var connection = window.BioViz.r.createConnection({ browser: demo.browser });
      var chart = window.BioViz.correlationMatrix(
        '#chart',
        Object.assign({}, demo.settings, { connection: connection })
      );
      window.BioVizDemo.chart = chart;
      return chart.init(demo.tables(study));
    }
  );
})();
