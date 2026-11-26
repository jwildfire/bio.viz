// The association scatter's demo: the chart, on the synthetic study, opening on
// the pair the study was planted with, TNF-alpha against IL-10 at Baseline,
// whose true Pearson correlation is 0.6, coloured by arm, with R attached, in
// this browser. R is started when the chart is first drawn, because the
// coefficient is the point of the chart.
//
// What the page sets is kept on `BioVizDemo.associationScatter`, where a script
// can read it without a page: tools/derive-association-statistics.mjs reads the
// settings and the tables from here to write the rows desktop R is run on, so
// the expected results are for this chart and no other.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  var demo = (window.BioVizDemo.associationScatter = {
    settings: {
      // What the figure is called, filled from the view drawn (#66).
      title: '{y} against {x}',
      subtitle: '{n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ],
      // The planted pair.
      x: { measure: 'TNF-alpha', visit: 'Baseline' },
      y: { measure: 'IL-10', visit: 'Baseline' },
      baseline_visits: 'Baseline',
      // A coefficient for the two arms together, and one for each.
      color_by: 'ARM',
      // R's straight line through the points, with its band.
      fit: 'linear',
      groups: labelled,
      filters: labelled,
      // The participant-level numbers an axis can take, beside the biomarkers.
      numbers: [
        { value_col: 'AGE', label: 'Age' },
        { value_col: 'BMIBL', label: 'BMI at baseline' }
      ],
      profile_details: labelled.concat([{ value_col: 'AGE', label: 'Age' }]),
      // The participant profile's time axis; see synthetic-study.js.
      studyday_col: 'DAY',
      // What the first statistic costs on this page, said while R starts. The
      // megabytes are the ones the browser tests measure (AS-LIVE-007).
      waiting_note:
        'The first statistic starts R in this browser: about 13 MB to download, once, and a few seconds.'
    },
    // R in the browser. The one file it is given is gsm.bio's statistics
    // functions, as vendored. The file is sourced with base R alone, so no R
    // package is installed.
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
      // Making the connection fetches nothing. R is started the first time the
      // chart asks for a statistic, which is when it is first drawn.
      var connection = window.BioViz.r.createConnection({ browser: demo.browser });
      var chart = window.BioViz.associationScatter(
        '#chart',
        Object.assign({}, demo.settings, { connection: connection })
      );
      window.BioVizDemo.chart = chart;
      return chart.init(demo.tables(study));
    }
  );
})();
