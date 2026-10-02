// The group comparison chart's demo: the chart, on the synthetic study, opening
// on the comparison the study was planted with — IL-6, change from Baseline to
// Week 4, by arm.
(function () {
  var labelled = [
    { value_col: 'ARM', label: 'Arm' },
    { value_col: 'SEX', label: 'Sex' },
    { value_col: 'RESPONSE', label: 'Response' }
  ];
  window.BioVizDemo.ready = window.BioVizDemo.loadStudy('../data/synthetic-study/').then(
    function (tables) {
      var chart = window.BioViz.groupComparison('#chart', {
        start_value: 'IL-6',
        visits: 'Week 4',
        value_type: 'change',
        baseline_visits: 'Baseline',
        group_by: 'ARM',
        groups: labelled,
        filters: labelled,
        profile_details: labelled.concat([{ value_col: 'AGE', label: 'Age' }]),
        // The participant profile's time axis; see synthetic-study.js.
        studyday_col: 'DAY'
      });
      window.BioVizDemo.chart = chart;
      return chart.init(tables);
    }
  );
})();
