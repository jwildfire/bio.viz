# The library core

What a page or a widget can rely on before it asks for anything else: where the bundles are, what they define, and the version they report. The charts and the connection to R each have a reference of their own.

## Loading the library

The bundles are committed, so a page needs no build step and no package manager. Copy the folder `dist/bio.viz-0.1.0/` and load the script-tag bundle; it defines one global, `BioViz`:

```html
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  console.log(BioViz.version); // "0.1.0"
</script>
```

An ES module bundle with the same exports sits beside it:

```js
import { version, r } from './dist/bio.viz-0.1.0/bio.viz.esm.js';
```

| File                                | What it is                                                |
| ----------------------------------- | --------------------------------------------------------- |
| `dist/bio.viz-0.1.0/bio.viz.js`     | The script-tag bundle. Defines the global `BioViz`.       |
| `dist/bio.viz-0.1.0/bio.viz.esm.js` | The ES module bundle. The same exports, as named exports. |
| `*.map`                             | A source map for each, so a debugger shows the source.    |

Nothing else is bundled into either file. safety.viz and R are loaded beside bio.viz on a page: safety.viz with its own script tag, and R the first time a statistic is asked for.

## `version`

A string: the version of the library, `0.1.0`. It equals the `version` field of `package.json` and is fixed when the bundle is built, so it says which build a page loaded. The folder the bundle sits in carries the same number.

## What else is exported

| Export | What it is                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| `r`    | The connection to R and the rule for printing a p-value. Its reference is [the connection to R](r-connection.md). |
