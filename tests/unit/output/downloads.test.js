import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { crc32 as zlibCrc32, deflateSync } from 'node:zlib';
import { csvField, parseCsv, statisticsTable, toCsv } from '../../../src/shared/csv.js';
import { crc32, pngChunks, readPng } from '../../../src/shared/png.js';
import { DOWNLOAD_DEFAULTS, VERSION_SAID } from '../../../src/shared/titles.js';
import { syncSettings as groupComparison } from '../../../src/group-comparison/configure.js';
import { syncSettings as associationScatter } from '../../../src/association-scatter/configure.js';
import { syncSettings as correlationMatrix } from '../../../src/correlation-matrix/configure.js';
import { syncSettings as biomarkerScreen } from '../../../src/biomarker-screen/configure.js';
import { syncSettings as crossTab } from '../../../src/cross-tab/configure.js';
import { syncSettings as stratifiedSurvival } from '../../../src/stratified-survival/configure.js';

// The downloads (#67): RFC 4180 CSV, the statistics R returned as a table, and
// the PNG's own record of its title and resolution.

const SYNCS = [
  groupComparison,
  associationScatter,
  correlationMatrix,
  biomarkerScreen,
  crossTab,
  stratifiedSurvival
];
const fixture = (file) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/${file}`, import.meta.url), 'utf8'));
const refusal = (make) => {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error('not refused');
};

describe('getting results out: the downloads', () => {
  it('EXP-CSV-001: a CSV is written by RFC 4180: CRLF between records; a field or a heading that holds a comma, a double quote, a carriage return or a line feed is quoted, with each double quote doubled; and it reads back field for field, a heading with a comma one heading (#67, #39)', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('Arm, randomised')).toBe('"Arm, randomised"');
    expect(csvField('say "no"')).toBe('"say ""no"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(csvField(Number.NaN)).toBe('NaN');
    expect(csvField(true)).toBe('TRUE');
    const columns = [
      { value_col: 'id', label: 'Participant' },
      { value_col: 'arm', label: 'Arm, randomised' },
      { value_col: 'note', label: 'Note "free text"' },
      { value_col: 'value', label: 'CRP (mg/L)' }
    ];
    const rows = [
      { id: 'BIO-001', arm: 'Placebo', note: 'said "fine", then left', value: 2.783 },
      { id: 'BIO-002', arm: 'Treatment', note: 'line one\r\nline two', value: null },
      { id: 'BIO-003', arm: 'Treatment', note: '', value: -0.000001 }
    ];
    const text = toCsv(rows, columns);
    expect(text).toBe(
      'Participant,"Arm, randomised","Note ""free text""",CRP (mg/L)\r\n' +
        'BIO-001,Placebo,"said ""fine"", then left",2.783\r\n' +
        'BIO-002,Treatment,"line one\r\nline two",\r\n' +
        'BIO-003,Treatment,,-0.000001\r\n'
    );
    expect(parseCsv(text)).toEqual([
      ['Participant', 'Arm, randomised', 'Note "free text"', 'CRP (mg/L)'],
      ['BIO-001', 'Placebo', 'said "fine", then left', '2.783'],
      ['BIO-002', 'Treatment', 'line one\r\nline two', ''],
      ['BIO-003', 'Treatment', '', '-0.000001']
    ]);
    // Every number reads back as itself.
    for (const value of [Math.PI, 1e-300, -2.5e21, 0.1 + 0.2]) {
      expect(Number(parseCsv(toCsv([{ v: value }], [{ value_col: 'v', label: 'v' }]))[1][0])).toBe(
        value
      );
    }
  });

  it('EXP-CSV-002: the statistics are R’s answer laid out as a table: a row for each answer’s result and one for each of its parts, every member R returned a column, every number R’s own, with the function asked and the data it was asked about; an answer R did not give has no rows (#67)', () => {
    const welch = fixture('group-statistics-r.json').results.find(
      (entry) => entry.case === 'welch'
    );
    const asked = [
      {
        name: welch.name,
        args: welch.args,
        dataId: welch.dataId,
        answer: { status: 'ok', value: welch.value }
      },
      { name: 'Analyze_Group', dataId: 'other', answer: null },
      { name: 'Analyze_Group', dataId: 'other', answer: { status: 'unavailable', message: 'x' } }
    ];
    const { columns, rows } = statisticsTable(asked);
    const keys = columns.map((column) => column.value_col);
    expect(keys.slice(0, 3)).toEqual(['asked', 'function', 'data/chart']);
    expect(columns.every((column) => column.label === column.value_col)).toBe(true);
    const result = rows.find((row) => row.part === 'result');
    expect(result).toMatchObject({
      asked: 1,
      function: welch.name,
      'data/measure': 'IL-6',
      'data/visit': 'Week 4',
      'data/groups': 'Placebo | Treatment',
      method: welch.value.method,
      p_value: welch.value.p_value,
      'counts/Placebo': welch.value.counts.Placebo,
      'counts/Treatment': welch.value.counts.Treatment
    });
    for (const [list, parts] of Object.entries(welch.value)) {
      if (!Array.isArray(parts) || !parts.some((part) => part && typeof part === 'object'))
        continue;
      parts.forEach((part, at) => {
        const row = rows.find((entry) => entry.part === list && entry.item === at + 1);
        for (const [member, value] of Object.entries(part)) {
          if (value !== null && typeof value !== 'object')
            expect(row[member], `${list} ${member}`).toBe(value);
        }
      });
    }
    // Only the answer R gave.
    expect(new Set(rows.map((row) => row.asked))).toEqual(new Set([1]));
    expect(statisticsTable([{ name: 'f', dataId: 'x', answer: null }]).rows).toEqual([]);
    // A screen's rows are parts of their own, one per biomarker.
    const screen = fixture('screen-statistics-r.json').results.find(
      (entry) => entry.case === 'difference-week-4-change'
    );
    const laid = statisticsTable([
      { name: screen.name, dataId: screen.dataId, answer: { status: 'ok', value: screen.value } }
    ]);
    const byBiomarker = laid.rows.filter((row) => row.part === 'rows');
    expect(byBiomarker.map((row) => row.biomarker)).toEqual(
      screen.value.rows.map((row) => row.biomarker)
    );
    byBiomarker.forEach((row, i) => {
      expect(row.estimate).toBe(screen.value.rows[i].estimate);
      expect(row.p_value).toBe(screen.value.rows[i].p_value);
    });
  });

  it('EXP-PNG-001: a downloaded PNG carries its resolution, as pixels per metre, and as international text its title, its description and the software with its version, and no other text, each chunk with its CRC, written after the header so any reader finds them (#67, #78)', () => {
    // A PNG of one white pixel, made with node's zlib, its CRCs node's own.
    const chunkOf = (type, data) => {
      const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlibCrc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const pixel = Uint8Array.from(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunkOf('IHDR', header),
        chunkOf('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
        chunkOf('IEND', Buffer.alloc(0))
      ])
    );
    for (const sample of ['IEND', 'iTXtTitle', 'a longer piece of text, ≤ 2.783']) {
      const bytes = new TextEncoder().encode(sample);
      expect(crc32(bytes), sample).toBe(zlibCrc32(bytes));
    }
    const written = pngChunks(pixel, {
      scale: 2,
      text: {
        Title: 'CRP ≤ 2.783 — Arm, randomised',
        Description: 'Drawn on 2026-10-04.',
        Software: `bio.viz ${VERSION_SAID}`,
        Empty: ''
      }
    });
    const read = readPng(written);
    // The three the chart writes, and nothing else: an empty text is left out.
    expect(read).toEqual({
      width: 1,
      height: 1,
      perMetre: Math.round((2 * 96) / 0.0254),
      text: {
        Title: 'CRP ≤ 2.783 — Arm, randomised',
        Description: 'Drawn on 2026-10-04.',
        Software: `bio.viz ${VERSION_SAID}`
      }
    });
    // What a chart's download writes is held to these three in the page by
    // EXP-SITE-001.
    // Each chunk's CRC is right.
    const view = new DataView(written.buffer);
    let at = 8;
    while (at < written.length) {
      const length = view.getUint32(at);
      expect(view.getUint32(at + 8 + length)).toBe(
        crc32(written.subarray(at + 4, at + 8 + length))
      );
      at += 12 + length;
    }
    expect(() => pngChunks(new Uint8Array(40), { scale: 1, text: {} })).toThrow('not a PNG');
  });

  it('EXP-DL-007: every chart takes `downloads`, true by default, and `png_scale`, 2 by default, from 1 to 4; anything else is refused with a sentence (#67)', () => {
    expect(DOWNLOAD_DEFAULTS).toEqual({ downloads: true, png_scale: 2 });
    for (const sync of SYNCS) {
      expect(sync()).toMatchObject(DOWNLOAD_DEFAULTS);
      expect(sync({ downloads: false, png_scale: 3 })).toMatchObject({
        downloads: false,
        png_scale: 3
      });
      expect(refusal(() => sync({ downloads: 'yes' }))).toBe(
        'bio.viz: `downloads` must be true or false.'
      );
      for (const scale of [0.5, 5, '2', Number.NaN]) {
        expect(refusal(() => sync({ png_scale: scale }))).toBe(
          'bio.viz: `png_scale` must be a number from 1 to 4: image pixels per CSS pixel.'
        );
      }
    }
  });
});

describe('getting results out: what the #70 review found', () => {
  it('EXP-CSV-003: every member R returned is a column, however nested: a list of objects or of lists in the data asked about is flattened by position (a list of values alone is one field), nested names are joined by a slash, and an R member that would take an identifying column’s name, or two names that would meet, is refused, not overwritten (#70 review)', () => {
    const matrix = fixture('matrix-statistics-r.json').results.find(
      (entry) => entry.case === 'biomarkers-baseline'
    );
    const { columns, rows } = statisticsTable([
      { name: matrix.name, dataId: matrix.dataId, answer: { status: 'ok', value: matrix.value } }
    ]);
    const keys = columns.map((column) => column.value_col);
    // The variables the grid's v1 … v12 stand for are in the file.
    expect(Array.isArray(matrix.dataId.variables)).toBe(true);
    matrix.dataId.variables.forEach((variable, i) => {
      for (const [member, value] of Object.entries(variable)) {
        if (value !== null && typeof value !== 'object') {
          expect(rows[0][`data/variables/${i + 1}/${member}`], `${i} ${member}`).toBe(value);
        }
      }
    });
    expect(keys).toContain('counts/v1');
    expect(rows.filter((row) => row.part === 'rows')).toHaveLength(matrix.value.rows.length);
    // A list of lists, and a mixed list, keep every value.
    const mixed = statisticsTable([
      {
        name: 'f',
        dataId: { grid: [[1, 2], [3]], mixed: ['a', { b: 1 }] },
        answer: { status: 'ok', value: { method: 'm', 'p.value': 0.5, p: { value: 0.25 } } }
      }
    ]).rows[0];
    expect(mixed).toMatchObject({
      'data/grid/1': '1 | 2',
      'data/grid/2': '3',
      'data/mixed/1': 'a',
      'data/mixed/2/b': 1,
      'p.value': 0.5,
      'p/value': 0.25
    });
    for (const member of ['asked', 'function', 'part', 'item']) {
      expect(() =>
        statisticsTable([
          { name: 'f', dataId: 'x', answer: { status: 'ok', value: { [member]: 1 } } }
        ])
      ).toThrow(
        `bio.viz: R’s answer has a member \`${member}\`, which the statistics file names itself`
      );
    }
    expect(() =>
      statisticsTable([
        { name: 'f', dataId: 'x', answer: { status: 'ok', value: { 'a/b': 1, a: { b: 2 } } } }
      ])
    ).toThrow('bio.viz: R’s answer has two members written `a/b`');
  });

  it('EXP-CSV-004: R’s NaN, Inf and -Inf are written as R writes them, apart from a value missing; a list of values is joined by “ | ”, which R’s notes do not use (#70 review)', () => {
    expect([Number.NaN, Infinity, -Infinity, null].map(csvField)).toEqual([
      'NaN',
      'Inf',
      '-Inf',
      ''
    ]);
    const { rows } = statisticsTable([
      {
        name: 'f',
        dataId: 'x',
        answer: { status: 'ok', value: { notes: ['one; two', 'three'], warnings: [] } }
      }
    ]);
    expect(rows[0].notes).toBe('one; two | three');
  });
});
