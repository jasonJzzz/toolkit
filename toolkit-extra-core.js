'use strict';

// 此工厂既可在页面测试中调用，也可序列化到 Worker 中，避免复杂正则阻塞页面。
function createExtraCore() {
  const vendor = toolkitVendor;

  function readJson(source) {
    // 转换工具的输出必须能精确表示输入，拒绝静默舍入的大整数。
    const value = JSON.parse(source);
    function check(item) {
      if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
        throw new Error('包含超出安全范围的数字，请先将大整数改为字符串。');
      }
      if (item && typeof item === 'object') Object.values(item).forEach(check);
    }
    check(value);
    return value;
  }

  function stringify(value) {
    const seen = new Set();
    // 检查循环引用和 YAML 中 JSON 无法表示的值，防止转换中丢失数据。
    function check(item) {
      if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
        throw new Error('包含 JSON 无法精确表示的数字。');
      }
      if (item && typeof item === 'object') {
        if (seen.has(item)) throw new Error('循环引用无法转换为 JSON。');
        seen.add(item);
        Object.values(item).forEach(check);
        seen.delete(item);
      }
    }
    check(value);
    if (value === undefined) throw new Error('请输入有效内容。');
    return JSON.stringify(value, null, 2);
  }

  function convertData({ source, mode }) {
    if (!source.trim()) throw new Error('请先粘贴需要转换的数据。');
    if (mode === 'json-yaml') return vendor.dump(readJson(source), { schema: vendor.JSON_SCHEMA, noRefs: true, lineWidth: -1 });
    if (mode === 'yaml-json') {
      return stringify(vendor.load(source, { schema: vendor.JSON_SCHEMA }));
    }
    if (mode === 'json-csv') {
      const rows = readJson(source);
      if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || Array.isArray(row) || typeof row !== 'object')) {
        throw new Error('JSON 转 CSV 需要非空对象数组，例如 [{"id":1,"name":"示例"}]。');
      }
      if (rows.some(row => Object.values(row).some(value => value !== null && typeof value === 'object'))) {
        throw new Error('CSV 不支持嵌套对象或数组，请先展开字段。');
      }
      const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
      if (!fields.length) throw new Error('没有可转换的字段。');
      return vendor.csv.unparse({ fields, data: rows }, { newline: '\r\n', quotes: true });
    }
    const parsed = vendor.csv.parse(source, { skipEmptyLines: 'greedy' });
    if (parsed.errors.length) throw new Error('CSV 格式错误：' + parsed.errors[0].message);
    const [headers, ...records] = parsed.data;
    if (!headers?.length || headers.some(name => !name.trim()) || new Set(headers).size !== headers.length) {
      throw new Error('CSV 第一行需要非空且不重复的字段名。');
    }
    if (records.some(row => row.length !== headers.length)) throw new Error('CSV 数据行的列数与表头不一致。');
    // 每格保留为字符串，避免编号前导零、长 ID 或布尔文本被自动转换。
    return stringify(records.map(row => Object.fromEntries(headers.map((name, i) => [name, row[i]]))));
  }

  function testRegex({ source, pattern, flags, replacement }) {
    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;
    while ((match = regex.exec(source)) !== null) {
      matches.push({ index: match.index, text: match[0], groups: match.slice(1), namedGroups: match.groups ?? null });
      if (!regex.global || matches.length === 1000) break;
      // 空匹配也必须前进，u/v 模式下跨过完整的 Unicode 码点。
      if (match[0] === '') {
        regex.lastIndex += (regex.unicode || regex.unicodeSets) && source.codePointAt(regex.lastIndex) > 0xFFFF ? 2 : 1;
      }
    }
    return { matches, limited: matches.length === 1000, replaced: source.replace(new RegExp(pattern, flags), replacement) };
  }

  function explainCron({ expression, dialect, timezone, start }) {
    const fields = expression.trim().split(/\s+/);
    const count = dialect === 'spring' ? 6 : 5;
    if (fields.length !== count) throw new Error('当前模式需要 ' + count + ' 个字段。');
    if (!fields.every(field => /^[\dA-Za-z*,/\-?]+$/.test(field))) {
      throw new Error('支持数字、名称、*、,、-、/，Spring 的日期和星期字段还支持 ?。');
    }
    // 仅允许月份和星期名称，不能将底层库支持的 L 等扩展误当作常规名称。
    fields.forEach((field, i) => {
      let remainder = field.toUpperCase();
      if (i === count - 2) remainder = remainder.replace(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/g, '');
      if (i === count - 1) remainder = remainder.replace(/SUN|MON|TUE|WED|THU|FRI|SAT/g, '');
      if (/[A-Z]/.test(remainder)) throw new Error('暂不支持 L、W 等扩展；月份和星期请使用三字母名称。');
    });
    if (fields.some((field, i) => field.includes('?') && !(dialect === 'spring' && [3, 5].includes(i) && field === '?'))) {
      throw new Error('? 只可单独用在 Spring 的日期或星期字段。');
    }
    const normalized = fields.map(field => field === '?' ? '*' : field);
    // cron-parser 的日期/星期规则采用 OR，Spring 同时限制时采用 AND，拒绝歧义组合。
    if (dialect === 'spring' && normalized[3] !== '*' && normalized[5] !== '*') {
      throw new Error('Spring 模式请将日期或星期中的一个设为 * 或 ?。');
    }
    const currentDate = start || new Date().toISOString();
    const iterator = vendor.CronExpressionParser.parse(normalized.join(' '), { currentDate, tz: timezone });
    const next = Array.from({ length: 5 }, () => iterator.next().toISOString());
    const format = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    return {
      description: vendor.cronDescription.toString(normalized.join(' '), { locale: 'zh_CN', use24HourTimeFormat: true }),
      next: next.map(iso => format.format(new Date(iso)).replaceAll('/', '-')),
    };
  }

  function run(kind, input) {
    if (kind === 'convert') return convertData(input);
    if (kind === 'regex') return testRegex(input);
    if (kind === 'cron') return explainCron(input);
    if (kind === 'jsonpath') {
      if (!input.path.trim().startsWith('$')) throw new Error('JSONPath 请以 $ 开头。');
      // safe 模式使用表达式解释器解析过滤条件，Worker 的超时也覆盖查询过程。
      const result = vendor.JSONPath({ path: input.path, json: readJson(input.source), eval: 'safe', wrap: true });
      return { count: result.length, output: stringify(result) };
    }
    if (kind === 'hash') {
      const bytes = input.bytes ? new Uint8Array(input.bytes) : new TextEncoder().encode(input.source);
      return Object.fromEntries(['md5', 'sha1', 'sha256', 'sha512'].map(name => [name, vendor.bytesToHex(vendor[name](bytes))]));
    }
    throw new Error('未知处理类型。');
  }
  return { run };
}
