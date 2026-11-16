'use strict';

// 核心方法只处理传入的数据，页面的事件、提示和渲染由 toolkit.js 负责。
const toolkitCore = (() => {
  const tokenPattern = /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g;
  const maxAlignmentCells = 2_000_000;
  const maxTime = 8_640_000_000_000_000n;

  // 先用 JSON.parse 校验，再从原文提取记号。这样大整数和数字写法都能原样保留。
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

  // 缩进为 0 时直接拼接记号实现压缩，字符串内部的空白会随记号保留。
  function formatJson(source, indentation = 2) {
    return formatTokens(jsonTokens(source), indentation);
  }

  // 遇到对象或数组的边界时调整嵌套层级，再用层级决定换行后的缩进。
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

  // 逐层拆开字符串包装，直到得到合法的 JSON 对象或数组。解析不了时返回 null。
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
          // 有些数据库工具复制字段时会省去外层引号，补上引号后再尝试解码。
          candidate = JSON.parse('"' + candidate + '"').trim();
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // 接受 JSON 原文或转义字段值。最外层是普通 JSON 字符串时，可以直接返回文本。
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
    // 冒号前的字符串是对象键。只递归展开可以解析为对象或数组的字符串值。
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

  // 按原文扫描一遍。双反斜杠作为一个整体处理，生成的反斜杠不会在本次继续解码。
  // \r、\n 和 \r\n 都统一成换行，\t 转成制表符，其余内容按原文保留。
  function restoreTextWhitespace(source) {
    const escapes = { '\\': '\\', n: '\n', r: '\n', 'r\\n': '\n', t: '\t' };
    return source.replace(/\\(r\\n|[\\nrt])/g, (_, escape) => escapes[escape]);
  }

  // 递归生成用于比较的结构。数字同时保存规范值和原始写法，分别用于比较和展示。
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

  // 把 1、1.0 和 1e0 化为相同的有效数字与指数，避免浮点数舍入。
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

  // 从根路径 $ 开始比较。对象按键匹配，数组按下标匹配，输出新增、删除和修改。
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

  // 共用于行对齐和行内字符对齐。先保留相同的首尾，再用最长公共子序列对齐中间部分。
  // 差异用 [旧下标, 新下标] 表示，缺失的一侧用 null。矩阵超出预算时，中间部分按整段差异处理。
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
      // 从右下角往回填表，每格记录从两个当前位置开始还能匹配多少项。
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

  // 对齐使用处理过的字符，标记通过位置映射写回原文，以保留大小写和空白。
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

  // 先按行对齐，再把同一差异段内可配对的删除行和新增行组合为修改行。
  // 忽略大小写或空白时只处理比较用的键，结果仍保留原文和原始行号。
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

  // Unicode 转义使用 \uXXXX。数字引用使用 &#数字;，编码时按原始文本逐个写出。
  function convertUnicode(source, mode) {
    if (source === '') throw new Error('请先输入需要转换的内容。');

    if (mode === 'encode') {
      return source.replace(/[\s\S]/g, (unit) => '\\u' + unit.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
    if (mode === 'encode-reference') {
      // 与参考工具一致，按 UTF-16 代码单元编码，表情可能生成两条数字引用。
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

  // 自动模式把最多 10 位的整数和带小数的值当秒，较长的整数当毫秒。
  // 用 BigInt 拼出整数毫秒，校验日期可表示范围后再转为 Number。
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

  // 先按 UTC 日历构造日期并核对各字段，识别会被 Date 自动滚动的日期。
  // 文本里的 Z 或显式偏移优先，其余情况使用页面选定的默认时区。
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

  // 同一个毫秒时间戳生成秒、毫秒、UTC 和北京时间四种展示值。
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

  // 公司工时规则统一以分钟表示，方便做加减和范围判断。
  const workStart = 9 * 60;
  const latestWorkStart = workStart + 30;
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60 + 30;
  const earliestDeparture = 18 * 60;
  const weeklyTarget = 40 * 60;

  function clockMinutes(value) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error('请输入有效的时间，格式为 HH:mm。');
    }
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function startMinutes(value, day) {
    const minutes = clockMinutes(value);
    if (minutes < workStart || minutes > latestWorkStart) {
      throw new Error(day + '上班时间应在 09:00–09:30 之间。');
    }
    return minutes;
  }

  // 只扣除上下班区间与午休区间重叠的部分，兼顾中午前或午休期间离开的情况。
  function workedMinutes(start, end) {
    const lunch = Math.max(0, Math.min(end, lunchEnd) - Math.max(start, lunchStart));
    return end - start - lunch;
  }

  // 先累计前四天工时，再比较周五做到 18:00 的工时与剩余工时。
  // 有缺口就从 18:00 往后补。若时间超出周五当天，departure 返回 null。
  function calculateFridayDeparture(workdays, fridayStart) {
    const days = ['周一', '周二', '周三', '周四'];
    const completed = workdays.reduce((total, { start, end }, index) => {
      const arrival = startMinutes(start, days[index]);
      const departure = clockMinutes(end);
      if (departure < arrival) throw new Error(days[index] + '下班时间不能早于上班时间。');
      return total + workedMinutes(arrival, departure);
    }, 0);
    const fridayArrival = startMinutes(fridayStart, '周五');
    const remaining = Math.max(0, weeklyTarget - completed);
    const workedByEarliestDeparture = workedMinutes(fridayArrival, earliestDeparture);
    const departure = earliestDeparture + Math.max(0, remaining - workedByEarliestDeparture);
    const lastMinuteOfDay = 24 * 60 - 1;
    return { completed, remaining, departure: departure <= lastMinuteOfDay ? departure : null };
  }

  return { formatJson, decodeJsonString, restoreTextWhitespace, compareJson, compareText, convertUnicode, parseTimestamp, parseDate, describeTime, calculateFridayDeparture };
})();
