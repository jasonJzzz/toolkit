'use strict';

const toolkitCore = (() => {
  const tokenPattern = /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g;
  const maxAlignmentCells = 2_000_000;
  const maxTime = 8_640_000_000_000_000n;

  function jsonTokens(source) {
    if (!source.trim()) throw new Error('请先输入 JSON。');
    try {
      JSON.parse(source);
    } catch (error) {
      const location = error.message.match(/position (\d+)/i);
      if (location) {
        const prefix = source.slice(0, Number(location[1]));
        const lines = prefix.split(/\r\n?|\n/);
        throw new Error('JSON 语法错误（第 ' + lines.length + ' 行，第 ' + (lines.at(-1).length + 1) + ' 列）。');
      }
      throw new Error('JSON 语法错误，请检查引号、括号和逗号。');
    }
    return source.match(tokenPattern);
  }

  function formatJson(source, indentation = 2) {
    return formatTokens(jsonTokens(source), indentation);
  }

  function formatTokens(tokens, indentation) {
    if (indentation === 0) return tokens.join('');

    const indent = ' '.repeat(indentation);
    const parts = [];
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      const next = tokens[index + 1];
      if (token === '{' || token === '[') {
        parts.push(token);
        depth++;
        if (next !== '}' && next !== ']') parts.push('\n', indent.repeat(depth));
      } else if (token === '}' || token === ']') {
        depth--;
        if (previous !== '{' && previous !== '[') parts.push('\n', indent.repeat(depth));
        parts.push(token);
      } else if (token === ',') {
        parts.push(',\n', indent.repeat(depth));
      } else {
        parts.push(token === ':' ? ': ' : token);
      }
    }
    return parts.join('');
  }

  function readJsonContainer(source) {
    let candidate = source.trim();

    while (candidate.startsWith('{') || candidate.startsWith('[') || candidate.startsWith('"')) {
      try {
        if (candidate.startsWith('"')) {
          candidate = JSON.parse(candidate).trim();
          continue;
        }
        return jsonTokens(candidate);
      } catch {
        if (!candidate.includes('\\')) return null;
        try {
          // Some database viewers copy the escaped value without its outer quotes.
          candidate = JSON.parse('"' + candidate + '"').trim();
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function decodeJsonString(source, indentation = 2) {
    if (!source.trim()) throw new Error('请先粘贴需要解码的字段值。');

    let tokens;
    try {
      tokens = jsonTokens(source);
    } catch {
      tokens = readJsonContainer(source);
      if (!tokens) throw new Error('无法解码，请粘贴完整字段值（不含字段名），并检查引号和转义。');
    }

    if (tokens[0].startsWith('"')) {
      const value = JSON.parse(tokens[0]);
      tokens = readJsonContainer(value);
      if (!tokens) return { output: value, kind: 'text', expanded: 0 };
    }

    const outputTokens = [];
    let expanded = 0;
    function expandValues(values) {
      for (let index = 0; index < values.length; index++) {
        const token = values[index];
        if (token.startsWith('"') && values[index + 1] !== ':') {
          const inner = readJsonContainer(JSON.parse(token));
          if (inner) {
            expanded++;
            expandValues(inner);
            continue;
          }
        }
        outputTokens.push(token);
      }
    }

    expandValues(tokens);
    return { output: formatTokens(outputTokens, indentation), kind: 'json', expanded };
  }

  function parseForComparison(source) {
    const tokens = jsonTokens(source);
    let index = 0;

    function readValue() {
      const token = tokens[index++];
      if (token === '{') {
        const entries = new Map();
        while (tokens[index] !== '}') {
          const key = JSON.parse(tokens[index]);
          index += 2;
          entries.set(key, readValue());
          if (tokens[index] === ',') index++;
        }
        index++;
        return { type: 'object', value: entries };
      }
      if (token === '[') {
        const entries = [];
        while (tokens[index] !== ']') {
          entries.push(readValue());
          if (tokens[index] === ',') index++;
        }
        index++;
        return { type: 'array', value: entries };
      }
      if (/^-?\d/.test(token)) {
        return { type: 'number', value: normalizeNumber(token), raw: token };
      }
      return { type: 'scalar', value: JSON.parse(token) };
    }

    try {
      return readValue();
    } catch (error) {
      if (error instanceof RangeError) throw new Error('JSON 嵌套过深，无法比较。');
      throw error;
    }
  }

  function normalizeNumber(token) {
    const [, sign, whole, fraction = '', exponent = '0'] = token.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    const digits = (whole + fraction).replace(/^0+/, '');
    if (!digits) return '0';
    const significant = digits.replace(/0+$/, '');
    const power = BigInt(exponent) + BigInt(digits.length - significant.length - fraction.length);
    return sign + significant + 'e' + power;
  }

  function displayJson(node) {
    if (node.type === 'object') {
      return '{' + Array.from(node.value, ([key, value]) => JSON.stringify(key) + ': ' + displayJson(value)).join(', ') + '}';
    }
    if (node.type === 'array') return '[' + node.value.map(displayJson).join(', ') + ']';
    if (node.type === 'number') return node.raw;
    return JSON.stringify(node.value);
  }

  function compareJson(beforeSource, afterSource) {
    let before;
    let after;
    try {
      before = parseForComparison(beforeSource);
    } catch (error) {
      throw new Error('原始 JSON：' + error.message);
    }
    try {
      after = parseForComparison(afterSource);
    } catch (error) {
      throw new Error('对比 JSON：' + error.message);
    }

    const changes = [];
    const visit = (left, right, path) => {
      if (!left || !right) {
        changes.push({ type: left ? 'removed' : 'added', path, before: left && displayJson(left), after: right && displayJson(right) });
        return;
      }
      if (left.type === 'object' && right.type === 'object') {
        for (const key of new Set([...left.value.keys(), ...right.value.keys()])) {
          const keyPath = /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
          visit(left.value.get(key), right.value.get(key), path + keyPath);
        }
        return;
      }
      if (left.type === 'array' && right.type === 'array') {
        for (let index = 0; index < Math.max(left.value.length, right.value.length); index++) {
          visit(left.value[index], right.value[index], path + '[' + index + ']');
        }
        return;
      }
      if (left.type !== right.type || left.value !== right.value) {
        changes.push({ type: 'changed', path, before: displayJson(left), after: displayJson(right) });
      }
    };
    try {
      visit(before, after, '$');
    } catch (error) {
      if (error instanceof RangeError) throw new Error('JSON 嵌套过深，无法比较。');
      throw error;
    }
    return changes;
  }

  function alignSequences(left, right, limit) {
    const pairs = [];
    let i = 0;
    let j = 0;

    while (i < left.length && j < right.length && left[i] === right[j]) pairs.push([i++, j++]);

    let leftEnd = left.length;
    let rightEnd = right.length;
    while (leftEnd > i && rightEnd > j && left[leftEnd - 1] === right[rightEnd - 1]) {
      leftEnd--;
      rightEnd--;
    }

    const oldCount = leftEnd - i;
    const newCount = rightEnd - j;
    const width = newCount + 1;
    const cells = (oldCount + 1) * width;
    const hasMiddle = oldCount > 0 && newCount > 0;
    const simplified = hasMiddle && cells > limit;
    if (hasMiddle && !simplified) {
      const startI = i;
      const startJ = j;
      const matches = new Uint32Array(cells);
      for (let row = oldCount - 1; row >= 0; row--) {
        for (let col = newCount - 1; col >= 0; col--) {
          const cell = row * width + col;
          matches[cell] = left[startI + row] === right[startJ + col]
            ? 1 + matches[cell + width + 1]
            : Math.max(matches[cell + width], matches[cell + 1]);
        }
      }

      while (i < leftEnd && j < rightEnd) {
        const cell = (i - startI) * width + j - startJ;
        if (left[i] === right[j]) pairs.push([i++, j++]);
        else if (matches[cell + width] >= matches[cell + 1]) pairs.push([i++, null]);
        else pairs.push([null, j++]);
      }
    }

    while (i < leftEnd) pairs.push([i++, null]);
    while (j < rightEnd) pairs.push([null, j++]);
    while (i < left.length) pairs.push([i++, j++]);
    return { pairs, simplified, cellsUsed: hasMiddle && !simplified ? cells : 0 };
  }

  function lineDiffSegments(before, after, options, limit) {
    function readCharacters(text) {
      const characters = Array.from(text);
      const positions = [];
      const keys = [];
      for (const [index, character] of characters.entries()) {
        if (options.ignoreWhitespace && /\s/.test(character)) continue;
        positions.push(index);
        keys.push(options.ignoreCase ? character.toLowerCase() : character);
      }
      return { characters, positions, keys };
    }

    function groupCharacters(characters, changedPositions) {
      const segments = [];
      for (const [index, character] of characters.entries()) {
        const changed = changedPositions.has(index);
        const previous = segments.at(-1);
        if (previous?.changed === changed) previous.text += character;
        else segments.push({ text: character, changed });
      }
      return segments;
    }

    const left = readCharacters(before);
    const right = readCharacters(after);
    const { pairs, simplified, cellsUsed } = alignSequences(left.keys, right.keys, limit);
    const removed = new Set();
    const added = new Set();
    for (const [i, j] of pairs) {
      if (j === null) removed.add(left.positions[i]);
      if (i === null) added.add(right.positions[j]);
    }

    return {
      before: groupCharacters(left.characters, removed),
      after: groupCharacters(right.characters, added),
      simplified,
      cellsUsed,
    };
  }

  function compareText(before, after, options = {}) {
    function readLines(text) {
      if (text === '') return [];
      const lines = text.split(/\r\n?|\n/).map((value, index) => {
        let key = options.ignoreWhitespace ? value.replace(/\s+/g, '') : value;
        if (options.ignoreCase) key = key.toLowerCase();
        return { text: value, number: index + 1, key };
      });
      return options.ignoreWhitespace ? lines.filter(({ key }) => key !== '') : lines;
    }

    const left = readLines(before);
    const right = readLines(after);
    const { pairs, simplified } = alignSequences(
      left.map(({ key }) => key), right.map(({ key }) => key), maxAlignmentCells,
    );
    const rows = [];
    let inlineBudget = maxAlignmentCells;
    let inlineSimplified = false;
    let removed = [];
    let added = [];

    function appendChanges() {
      const pairedCount = simplified ? 0 : Math.min(removed.length, added.length);
      for (let index = 0; index < pairedCount; index++) {
        const oldLine = removed[index];
        const newLine = added[index];
        const segments = lineDiffSegments(oldLine.text, newLine.text, options, Math.min(inlineBudget, 160_000));
        inlineBudget -= segments.cellsUsed;
        inlineSimplified ||= segments.simplified;
        rows.push({ type: 'changed', oldLine, newLine, before: segments.before, after: segments.after });
      }
      for (const oldLine of removed.slice(pairedCount)) rows.push({ type: 'removed', oldLine });
      for (const newLine of added.slice(pairedCount)) rows.push({ type: 'added', newLine });
      removed = [];
      added = [];
    }

    for (const [i, j] of pairs) {
      if (i === null) added.push(right[j]);
      else if (j === null) removed.push(left[i]);
      else {
        appendChanges();
        rows.push({ type: 'same', oldLine: left[i], newLine: right[j] });
      }
    }
    appendChanges();
    return { rows, simplified, inlineSimplified };
  }

  function convertUnicode(source, mode) {
    if (source === '') throw new Error('请先输入需要转换的内容。');

    if (mode === 'encode') {
      return source.replace(/[\s\S]/g, (unit) => '\\u' + unit.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
    if (mode === 'encode-reference') {
      // Match the reference tools' UTF-16 code units, including surrogate pairs.
      return source.replace(/[\s\S]/g, (unit) => '&#' + unit.charCodeAt(0) + ';');
    }
    if (mode === 'decode-reference') {
      return source.replace(/&#(?:(\d+)|x([\da-f]+));/gi, (_, decimal, hex) => {
        const value = hex ? parseInt(hex, 16) : Number(decimal);
        if (value > 0x10FFFF) throw new Error('数字引用超出 Unicode 范围。');
        return String.fromCodePoint(value);
      });
    }

    return source.replace(/\\\\|\\u(?:\{[^}]*\}?|[\da-f]{0,4})/gi, (escape) => {
      if (escape === '\\\\') return escape;
      if (/^\\u[\da-f]{4}$/i.test(escape)) return String.fromCharCode(parseInt(escape.slice(2), 16));
      const point = escape.match(/^\\u\{([\da-f]{1,6})\}$/i);
      const value = point ? parseInt(point[1], 16) : NaN;
      if (value <= 0x10FFFF) return String.fromCodePoint(value);
      throw new Error('Unicode 转义格式无效，请使用 \\u4E2D 或 \\u{1F600}。');
    });
  }

  function asMilliseconds(value) {
    if (value < -maxTime || value > maxTime) throw new Error('超出可表示的日期范围。');
    return Number(value);
  }

  function parseTimestamp(source, unit) {
    const input = source.trim();
    const parts = input.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!parts) throw new Error('请输入有效的 Unix 时间戳，例如 1704067200。');
    const [, sign, whole, fraction] = parts;
    const detected = unit === 'auto'
      ? (fraction || whole.replace(/^0+(?=\d)/, '').length <= 10 ? 'seconds' : 'milliseconds')
      : unit;
    if (fraction && detected === 'milliseconds') throw new Error('毫秒时间戳应为整数。');
    if (fraction && fraction.length > 3) throw new Error('秒时间戳最多支持三位小数。');

    const integer = BigInt(whole);
    const milliseconds = detected === 'seconds'
      ? integer * 1000n + BigInt((fraction || '').padEnd(3, '0'))
      : integer;
    return { milliseconds: asMilliseconds(sign === '-' ? -milliseconds : milliseconds), unit: detected };
  }

  function parseDate(source, fallbackOffset) {
    const parts = source.trim().match(/^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i);
    if (!parts) throw new Error('请输入 YYYY-MM-DD HH:mm:ss 或 ISO 8601 日期时间。');
    const [, rawYear, rawMonth, rawDay, rawHour = '0', rawMinute = '0', rawSecond = '0', fraction = '', timezone] = parts;
    const [year, month, day, hour, minute, second] = [rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond].map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, Number(fraction.padEnd(3, '0')));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
        || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
      throw new Error('日期或时间不存在，请检查月份、日期和时分秒。');
    }

    let offset = fallbackOffset;
    if (timezone?.toUpperCase() === 'Z') {
      offset = 0;
    } else if (timezone) {
      const digits = timezone.slice(1).replace(':', '');
      const offsetHours = Number(digits.slice(0, 2));
      const offsetMinutes = Number(digits.slice(2));
      if (offsetHours > 23 || offsetMinutes > 59) throw new Error('时区偏移无效。');
      offset = (timezone.startsWith('-') ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
    }

    return asMilliseconds(BigInt(date.getTime()) - BigInt(offset * 60_000));
  }

  function describeTime(milliseconds) {
    const date = new Date(milliseconds);
    const utc = date.toISOString();
    const beijing = new Date(milliseconds + 8 * 60 * 60 * 1000);
    const absolute = BigInt(Math.abs(milliseconds));
    const fraction = String(absolute % 1000n).padStart(3, '0').replace(/0+$/, '');
    const seconds = (milliseconds < 0 ? '-' : '') + absolute / 1000n + (fraction ? '.' + fraction : '');
    return {
      seconds,
      milliseconds: String(milliseconds),
      utc,
      beijing: Number.isNaN(beijing.getTime()) ? '超出日期范围' : beijing.toISOString().replace('T', ' ').replace('Z', ''),
    };
  }

  return { formatJson, decodeJsonString, compareJson, compareText, convertUnicode, parseTimestamp, parseDate, describeTime };
})();
