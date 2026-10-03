# safety-histogram requirements matrix

> Auto-harvested from the wiki. Review before implementation.

## Source inventory

- `Technical-Documentation.md`
- `Configuration.md`

## Requirements

| ID           | Area | Requirement                                                                               | Source             | Evidence Type | Test/Evidence Link | Status      | AI Review | Notes            |
| ------------ | ---- | ----------------------------------------------------------------------------------------- | ------------------ | ------------- | ------------------ | ----------- | --------- | ---------------- |
| SH-FUNC-004A | FUNC | Render a gray normal-range band behind histogram data using the measure limits.           | wiki::Normal Range | browser       | [link](x)          | reviewed    | OK        | split row        |
| SH-FUNC-004B | FUNC | Normal ranges are hidden by default and shown via the Normal Range checkbox.              | wiki::Normal Range | browser       | [link](x)          | reviewed    | OK        | split row        |
| SH-CFG-005   | CFG  | Missing and non-numeric results are dropped and counted.                                  | wiki::Data         | unit          | TBD                | ai-reviewed | OK        | data row         |
| SH-REG-013   | REG  | Confirm that adding a filter such as {"value_col":"SITE"} \| leaves the x-axis unchanged. | wiki::Reg          | browser       | TBD                | ai-reviewed | OK        | escaped-pipe row |
