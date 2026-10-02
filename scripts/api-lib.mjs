// The API reference, and the checks that keep it true to the code.
//
// Each module has one reference file in docs/, written by hand, and the site's
// API reference page is that file rendered: there is no second copy to keep in
// step. What can still drift is the file against the code, so three things are
// checked whenever the site is built:
//
//   1. everything the bundle exports is claimed by a module and has a heading
//      in that module's reference file;
//   2. a function the file documents under a heading is really exported;
//   3. every parameter the source documents (the `@param` lines of an export's
//      JSDoc comment) is named in the file's section for that export;
//   4. an exported constant's value is given in its section;
//   5. every setting of a chart (the keys of the DEFAULT_SETTINGS its registry
//      entry points at) has a table row of its own in the file.
//
// A module says what it documents in site/config.json:
//
//   "api": { "doc": "r-connection.md", "surface": ["r"], "source": ["src/r"] }
//
// and a chart adds where its settings are:
//
//   "api": { …, "settings": "src/group-comparison/configure.js" }
//
// `surface` lists top-level exports of the bundle. One that is a namespace
// (`r`, which a page reads as `BioViz.r`) stands for every member of it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const isNamespace = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The names a module must document: [{ name, path }], where `path` is how a
// page reaches it (`BioViz.r.createConnection` is path `r.createConnection`).
export function surfaceNames(bundle, surface = []) {
  const names = [];
  for (const key of surface) {
    if (!(key in bundle)) {
      names.push({ name: key, path: key, missing: true });
    } else if (isNamespace(bundle[key])) {
      for (const member of Object.keys(bundle[key])) {
        names.push(entry(member, `${key}.${member}`, bundle[key][member]));
      }
    } else {
      names.push(entry(key, key, bundle[key]));
    }
  }
  return names;
}

// A constant's value travels with its name, so the reference can be held to it.
function entry(name, reach, value) {
  const constant = typeof value === 'string' || typeof value === 'number';
  return constant ? { name, path: reach, value } : { name, path: reach };
}

// Top-level exports of the bundle that no module's `surface` claims.
export function unclaimedExports(bundle, modules) {
  const claimed = new Set(modules.flatMap((entry) => (entry.api && entry.api.surface) || []));
  return Object.keys(bundle)
    .filter((key) => !claimed.has(key))
    .sort();
}

// The parameter names of each documented export in a piece of source: every
// `@param` of the JSDoc comment that sits directly above an `export`. A type in
// braces may itself hold braces and run over several lines, so it is skipped by
// counting them. A comment above something that is not exported is passed over:
// the match never runs past the end of one comment.
export function jsdocParams(source) {
  const documented = {};
  const comment =
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const [, body, name] of String(source).matchAll(comment)) {
    const params = [];
    for (const tag of body.matchAll(/@param\b/g)) {
      let at = tag.index + tag[0].length;
      while (/\s/.test(body[at] || '')) at += 1;
      if (body[at] === '{') {
        let depth = 0;
        do {
          if (body[at] === '{') depth += 1;
          if (body[at] === '}') depth -= 1;
          at += 1;
        } while (depth > 0 && at < body.length);
      }
      const named = body.slice(at).match(/^[\s*]*\[?([A-Za-z_$][\w$.]*)/);
      if (named) params.push(named[1]);
    }
    documented[name] = params;
  }
  return documented;
}

// Every .js file under the given files and folders, read and joined.
export function readSources(rootDir, sources = []) {
  const files = [];
  const walk = (target) => {
    if (statSync(target).isDirectory()) {
      for (const entry of readdirSync(target).sort()) walk(path.join(target, entry));
    } else if (target.endsWith('.js')) {
      files.push(target);
    }
  };
  sources.forEach((source) => walk(path.join(rootDir, source)));
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

const FENCE = /^```/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The file's headings with the lines beneath each, up to the next heading of
// the same level or higher. Lines inside a code fence are never headings.
function sections(markdown) {
  const lines = String(markdown).split('\n');
  const found = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) found.push({ level: heading[1].length, text: heading[2], start: index });
  });
  return found.map((section, position) => {
    const next = found.slice(position + 1).find((later) => later.level <= section.level);
    return {
      ...section,
      body: lines.slice(section.start + 1, next ? next.start : undefined).join('\n')
    };
  });
}

// A heading documents `name` when it carries it in code: `name`, `name(…)`.
const headingNames = (heading, name) =>
  new RegExp('`' + escapeRegExp(name) + '(?![\\w$.])').test(heading);

// The ways a reference file and the code disagree; an empty list means none.
//
//   names   what the module must document, from `surfaceNames`
//   params  the parameters the source documents, from `jsdocParams`
export function checkApiReference({ module, doc, markdown, names, params = {}, settings = [] }) {
  const problems = [];
  const where = `${module}: ${doc}`;
  const all = sections(markdown);
  if (names.length === 0) problems.push(`${where} documents nothing: its surface is empty.`);

  for (const { name, path: reach, missing, value } of names) {
    if (missing) {
      problems.push(
        `${module}: site/config.json lists \`${reach}\`, which the bundle does not export.`
      );
      continue;
    }
    const section = all.find((candidate) => headingNames(candidate.text, name));
    if (!section) {
      problems.push(`${where} has no heading for \`${reach}\`, which the bundle exports.`);
      continue;
    }
    if (value !== undefined && !`${section.text}\n${section.body}`.includes(String(value))) {
      problems.push(`${where} does not give the value of \`${reach}\`, which is ${value}.`);
    }
    for (const param of params[name] || []) {
      const [root, ...rest] = param.split('.');
      const documented = rest.length
        ? section.body.includes('`' + rest.join('.') + '`')
        : new RegExp(`\\b${escapeRegExp(root)}\\b`).test(section.text);
      if (!documented) {
        problems.push(
          `${where} does not name \`${param}\`, a parameter the source documents for \`${name}\`.`
        );
      }
    }
  }

  // A chart's settings are part of its interface: each has a row of its own in
  // a table of the file. A mention in passing is not a description.
  const rows = new Set(
    String(markdown)
      .split('\n')
      .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
      .filter(Boolean)
      .map((match) => match[1])
  );
  for (const setting of settings) {
    if (!rows.has(setting)) {
      problems.push(
        `${where} has no table row for the setting \`${setting}\`, which the chart has.`
      );
    }
  }

  // A heading that documents a call, `name(…)`, must be a real export. A call
  // on something returned (`connection.run(…)`) is not one, and is left alone.
  const exported = new Set(names.map((entry) => entry.name));
  for (const section of all) {
    for (const [, called] of section.text.matchAll(/`([A-Za-z_$][\w$]*)\(/g)) {
      if (!exported.has(called)) {
        problems.push(`${where} documents \`${called}()\`, which the bundle does not export.`);
      }
    }
  }
  return problems;
}
