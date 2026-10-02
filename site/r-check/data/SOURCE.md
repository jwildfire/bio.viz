# Where this data came from

Two small tables for the R check page, cut by [`tools/cut-r-check-fixture.mjs`](../../../tools/cut-r-check-fixture.mjs) from the public example data vendored in safety.viz at commit [`5911a14`](https://github.com/jwildfire/safety.viz/tree/5911a14529f9ca15a38614b2cb630bfb4c3c9863/site/data) of its `dev` branch.

| File | Rows | Cut from | What it holds |
| --- | ---: | --- | --- |
| `alt-week-8.csv` | 122 | `site/data/adbds.csv` | Alanine Aminotransferase at Week 8 for the Placebo and Xanomeline High Dose arms: participant, arm, value (U/L). |
| `days-on-study.csv` | 254 | `site/data/adsl.csv` | Every participant in the safety population: participant, arm, day of end of study, and whether the participant discontinued (1) or completed (0). |

safety.viz builds those files from [pharmaverseadam](https://github.com/pharmaverse/pharmaverseadam), the pharmaverse consortium's ADaM test data, which is derived from the public CDISC SDTM/ADaM Pilot 01 study (`CDISCPILOT01`). pharmaverseadam is licensed [Apache-2.0](https://github.com/pharmaverse/pharmaverseadam/blob/main/LICENSE). How safety.viz derives its files is described in its [`docs/DATA_SOURCES.md`](https://github.com/jwildfire/safety.viz/blob/5911a14529f9ca15a38614b2cb630bfb4c3c9863/docs/DATA_SOURCES.md).

Only rows of the published study are taken: the synthetic cohorts safety.viz appends to its lab file are left out. No value is changed. The data is public test data and describes no real participant's care.

Do not edit these files by hand; rerun the script.
