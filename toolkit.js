'use strict';

// 本文件连接 HTML 控件和 toolkitCore。事件处理负责取值、调用计算方法和展示结果。
const $ = (id) => document.getElementById(id);
const tools = Array.from(document.querySelectorAll('.tool'));
const navigation = Array.from(document.querySelectorAll('.tools-nav a'));
const changeLabels = { added: '新增', removed: '删除', changed: '修改', same: '相同' };
const workHoursEntry = $('work-hours-entry');
const workHoursLink = $('work-hours-link');
const workHoursTool = $('tool-work-hours');
const brandButton = $('brand-button');

// 每次加载随机选一张图片，让侧栏徽标和浏览器标签页图标使用同一张。
const brandIcon = './assets/tu' + (Math.floor(Math.random() * 3) + 1) + '.jpg';
document.querySelector('link[rel="icon"]').href = brandIcon;
document.querySelector('.brand-icon').src = brandIcon;

// 每次连续点击左上角图片达到此次数，就切换侧栏中的「下班计算器」。
const workHoursUnlockClicks = 5;
let brandClicks = 0;
let lastBrandClick = 0;
// 点了别处或相邻两次间隔超过 2 秒都会重新计数，刷新后入口恢复隐藏。
document.addEventListener('click', (event) => {
  if (!brandButton.contains(event.target)) {
    brandClicks = 0;
    return;
  }

  const now = performance.now();
  if (now - lastBrandClick > 2000) brandClicks = 0;
  lastBrandClick = now;
  brandClicks++;
  if (brandClicks === workHoursUnlockClicks) {
    brandClicks = 0;
    const expanded = workHoursEntry.inert;
    // inert 立即改变入口的可操作性，CSS 负责渐变高度和透明度。
    workHoursEntry.inert = !expanded;
    brandButton.setAttribute('aria-expanded', String(expanded));
    if (!expanded && !workHoursTool.hidden) {
      window.history.replaceState(null, '', '#json-format');
      showTool();
    }
  }
});

// 用 URL 中的 #片段选择对应的 tool-<名称> 区块，同时更新侧栏选中状态。
function showTool() {
  let route = window.location.hash.slice(1);
  if (route === 'workspace') return;
  // 与侧栏共用入口的显示状态，未解锁时直接输入 #work-hours 也会回到默认页。
  if (workHoursEntry.inert && window.location.hash === workHoursLink.hash) {
    route = 'json-format';
    window.history.replaceState(null, '', '#json-format');
  }
  const active = tools.find((tool) => tool.id === 'tool-' + route) || tools[0];
  for (const tool of tools) tool.hidden = tool !== active;
  for (const link of navigation) {
    if (link.hash === '#' + active.id.slice(5)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showTool);
showTool();

function status(id, message = '', error = false) {
  const target = $(id);
  target.textContent = message;
  target.classList.toggle('error', error);
}

// 通过 textContent 写入用户输入或计算结果，浏览器会把内容按文本展示。
function makeElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function appendSummary(id, types, rows) {
  const counts = Object.fromEntries(types.map((type) => [type, 0]));
  for (const { type } of rows) counts[type]++;
  $(id).replaceChildren(...types.map((type) => makeElement('span', 'tag ' + type, changeLabels[type] + ' ' + counts[type])));
}

// 将核心返回的字段路径和变更类型组装成差异卡片。
function renderJsonDiff() {
  clearComparison('json');
  try {
    const changes = toolkitCore.compareJson($('json-before').value, $('json-after').value);
    appendSummary('json-summary', ['added', 'removed', 'changed'], changes);
    const fragment = document.createDocumentFragment();
    if (!changes.length) fragment.append(makeElement('p', 'empty-result', '两份 JSON 的内容相同。'));
    for (const change of changes) {
      const item = makeElement('div', 'change');
      const heading = makeElement('div', 'change-head');
      heading.append(makeElement('span', 'tag ' + change.type, changeLabels[change.type]), makeElement('code', '', change.path));
      const values = makeElement('div', 'change-values');
      const before = makeElement('code', change.before === undefined ? 'missing' : 'before', change.before ?? '无原值');
      const after = makeElement('code', change.after === undefined ? 'missing' : 'after', change.after ?? '无新值');
      before.title = '原值';
      after.title = '新值';
      values.append(before, after);
      item.append(heading, values);
      fragment.append(item);
    }
    $('json-changes').replaceChildren(fragment);
    $('json-result').hidden = false;
    status('json-status', changes.length ? '找到 ' + changes.length + ' 处字段差异。' : '比较完成。');
  } catch (error) {
    status('json-status', error.message, true);
  }
}

// 渲染两列原文和行内高亮。「只显示差异」过滤显示行，统计仍包含全部行。
function renderTextDiff() {
  clearComparison('text');
  const before = $('text-before').value;
  const after = $('text-after').value;
  if (!before && !after) {
    status('text-status', '请先输入需要比较的文本。', true);
    return;
  }

  const { rows, simplified, inlineSimplified } = toolkitCore.compareText(before, after, {
    ignoreCase: $('text-ignore-case').checked,
    ignoreWhitespace: $('text-ignore-whitespace').checked,
  });
  const changes = rows.filter(({ type }) => type !== 'same');
  const visibleRows = $('text-only-changes').checked ? changes : rows;
  appendSummary('text-summary', ['changed', 'added', 'removed', 'same'], rows);

  function appendSide(row, line, segments, tone, label) {
    const number = makeElement('td', 'diff-number ' + tone, line?.number);
    const cell = makeElement('td', 'diff-text ' + tone);
    if (line) {
      number.setAttribute('aria-label', label + '第 ' + line.number + ' 行');
      if (segments) {
        for (const segment of segments) {
          cell.append(segment.changed ? makeElement('mark', '', segment.text) : document.createTextNode(segment.text));
        }
      } else {
        cell.textContent = line.text;
      }
    }
    row.append(number, cell);
  }

  const fragment = document.createDocumentFragment();
  for (const row of visibleRows) {
    const entry = makeElement('tr', 'diff-row ' + row.type);
    const beforeTone = row.oldLine ? (row.type === 'same' ? '' : 'removed') : 'diff-gap';
    const afterTone = row.newLine ? (row.type === 'same' ? '' : 'added') : 'diff-gap';
    appendSide(entry, row.oldLine, row.before, beforeTone, '原文');
    appendSide(entry, row.newLine, row.after, afterTone, '对比文本');
    fragment.append(entry);
  }
  if (!visibleRows.length) {
    const empty = makeElement('tr', '');
    const message = makeElement('td', 'empty-result', '当前选项下没有差异。');
    message.colSpan = 4;
    empty.append(message);
    fragment.append(empty);
  }

  $('text-lines').replaceChildren(fragment);
  $('text-result-scroll').scrollTop = 0;
  $('text-result').hidden = false;
  let message = changes.length ? '找到 ' + changes.length + ' 行差异。' : '当前选项下没有差异。';
  if (simplified) message += '文本较长，部分变动按整段显示。';
  if (inlineSimplified) message += '部分长行的行内高亮已简化。';
  status('text-status', message);
}

for (const option of ['text-ignore-case', 'text-ignore-whitespace', 'text-only-changes']) {
  $(option).addEventListener('change', () => {
    if (!$('text-result').hidden) renderTextDiff();
  });
}

function clearComparison(id) {
  $(id + '-result').hidden = true;
  status(id + '-status');
}

const compareExamples = {
  json: ['{"id":9007199254740993,"quantity":100,"price":20,"remark":"草稿"}',
    '{"quantity":120,"id":9007199254740993,"price":20,"approved":true}'],
  text: ['订单已创建\n数量：100\n状态：待审批\n检查库存',
    '订单已创建\n数量：120\n状态：待审批\n检查库存\n等待回调'],
};

// 两个比较工具采用同一套控件命名，共享示例、清空和交换事件的绑定方式。
for (const [id, example] of Object.entries(compareExamples)) {
  const before = $(id + '-before');
  const after = $(id + '-after');
  const compare = id === 'json' ? renderJsonDiff : renderTextDiff;
  $('compare-' + id).addEventListener('click', compare);
  $(id + '-example').addEventListener('click', () => {
    [before.value, after.value] = id === 'json' ? example.map((value) => toolkitCore.formatJson(value)) : example;
    compare();
  });
  $(id + '-clear').addEventListener('click', () => {
    before.value = '';
    after.value = '';
    clearComparison(id);
    before.focus();
  });
  $(id + '-swap').addEventListener('click', () => {
    [before.value, after.value] = [after.value, before.value];
    if (!$(id + '-result').hidden) compare();
    else clearComparison(id);
  });
  for (const field of [before, after]) field.addEventListener('input', () => clearComparison(id));
}

const formatInput = $('json-input');
const formatOutput = $('json-output');
const formatCopy = document.querySelector('[data-copy="json-output"]');

// 各工具的两个编辑框独立成对。拖动一侧调高时，只同步同组的另一侧。
for (const grid of document.querySelectorAll('.format-editors')) {
  const editors = grid.querySelectorAll('textarea');
  let editorHeight = '';
  const observer = new ResizeObserver((entries) => {
    const resized = entries.find(({ target }) => target.style.height && target.style.height !== editorHeight);
    if (!resized) return;

    editorHeight = resized.target.style.height;
    requestAnimationFrame(() => {
      for (const editor of editors) {
        if (editor.style.height !== editorHeight) editor.style.height = editorHeight;
      }
    });
  });
  for (const editor of editors) observer.observe(editor);
}

function refreshFormatCounts() {
  for (const input of [formatInput, formatOutput]) {
    const lines = input.value === '' ? 0 : input.value.split('\n').length;
    $(input.id + '-count').textContent = lines + ' 行 · ' + Array.from(input.value).length + ' 字符';
  }
  formatCopy.disabled = formatOutput.value === '';
}

// 格式化和压缩只传不同缩进，解码按钮另外启用多层 JSON 字段解码。
function formatJson(indent, decode = false) {
  try {
    if (decode) {
      const result = toolkitCore.decodeJsonString(formatInput.value, indent);
      formatOutput.value = result.output;
      let message = result.kind === 'text' ? '已解码为文本。' : '已解码并格式化 JSON。';
      if (result.expanded) message += '已展开 ' + result.expanded + ' 处内层 JSON。';
      status('format-status', message);
    } else {
      formatOutput.value = toolkitCore.formatJson(formatInput.value, indent);
      status('format-status', indent ? 'JSON 校验通过，已格式化。' : 'JSON 校验通过，已压缩。');
    }
  } catch (error) {
    formatOutput.value = '';
    status('format-status', error.message, true);
  }
  refreshFormatCounts();
}

$('format-json').addEventListener('click', () => formatJson(Number($('json-indent').value)));
$('compact-json').addEventListener('click', () => formatJson(0));
$('decode-json').addEventListener('click', () => formatJson(Number($('json-indent').value), true));
$('decode-example').addEventListener('click', () => {
  const rawResult = JSON.stringify({ is_sensitive: false, evidence: ['示例文本'] }, null, 2);
  const imageResults = JSON.stringify([{ resourceId: 'CONTENT_PIC_1', rawResult }]);
  formatInput.value = JSON.stringify(imageResults);
  formatJson(Number($('json-indent').value), true);
});
$('format-example').addEventListener('click', () => {
  formatInput.value = '{"id":9007199254740993,"items":[{"sku":"SKU-001","quantity":100}],"approved":false}';
  formatJson(Number($('json-indent').value));
});
$('format-clear').addEventListener('click', () => {
  formatInput.value = '';
  clearFormatOutput();
  formatInput.focus();
});

function clearFormatOutput() {
  formatOutput.value = '';
  status('format-status');
  refreshFormatCounts();
}
formatInput.addEventListener('input', clearFormatOutput);
refreshFormatCounts();

const textFormatInput = $('text-format-input');
const textFormatOutput = $('text-format-output');
const textFormatCopy = document.querySelector('[data-copy="text-format-output"]');

function clearTextFormatOutput() {
  textFormatOutput.value = '';
  textFormatCopy.disabled = true;
  status('text-format-status');
}

// 普通文本直接还原换行和制表符，输入可以没有外层引号。
function formatPlainText() {
  const source = textFormatInput.value;
  if (source === '') {
    status('text-format-status', '请先粘贴需要处理的文本。', true);
    return;
  }

  const output = toolkitCore.restoreTextWhitespace(source);
  textFormatOutput.value = output;
  textFormatCopy.disabled = false;
  status('text-format-status', output === source ? '未找到需要还原的转义。' : '已还原文本转义。');
}

$('format-text').addEventListener('click', formatPlainText);
textFormatInput.addEventListener('input', clearTextFormatOutput);
$('text-format-example').addEventListener('click', () => {
  textFormatInput.value = '大家好！\\n\\n这是第二段。\\r\\n姓名\\t部门';
  formatPlainText();
});
$('text-format-clear').addEventListener('click', () => {
  textFormatInput.value = '';
  clearTextFormatOutput();
  textFormatInput.focus();
});

function clearTimeResult() {
  $('timestamp-result').hidden = true;
  status('timestamp-status');
}

// 两个转换方向统一返回毫秒，再交给同一个结果面板显示。
function showTime(milliseconds, message) {
  for (const [key, value] of Object.entries(toolkitCore.describeTime(milliseconds))) $('time-' + key).textContent = value;
  $('timestamp-result').hidden = false;
  status('timestamp-status', message);
}

function convertTimestamp() {
  clearTimeResult();
  try {
    const parsed = toolkitCore.parseTimestamp($('timestamp-input').value, $('timestamp-unit').value);
    showTime(parsed.milliseconds, '已按' + (parsed.unit === 'seconds' ? '秒' : '毫秒') + '解析时间戳。');
  } catch (error) {
    status('timestamp-status', error.message, true);
  }
}

$('timestamp-form').addEventListener('submit', (event) => {
  event.preventDefault();
  convertTimestamp();
});
$('date-form').addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeResult();
  try {
    const time = toolkitCore.parseDate($('date-input').value, Number($('date-zone').value));
    showTime(time, '已将日期时间转换为 Unix 时间戳。');
  } catch (error) {
    status('timestamp-status', error.message, true);
  }
});
$('timestamp-now').addEventListener('click', () => {
  const time = Date.now();
  $('timestamp-input').value = String(time);
  $('timestamp-unit').value = 'milliseconds';
  // 日期输入框填到秒。省去时区后缀后，将默认时区同步为 UTC。
  $('date-input').value = new Date(time).toISOString().split('.')[0].replace('T', ' ');
  $('date-zone').value = '0';
  showTime(time, '已读取当前时间。');
});
$('timestamp-example').addEventListener('click', () => {
  $('timestamp-input').value = '1704067200';
  $('timestamp-unit').value = 'auto';
  $('date-input').value = '2024-01-01 08:00:00';
  $('date-zone').value = '480';
  convertTimestamp();
});
$('timestamp-clear').addEventListener('click', () => {
  $('timestamp-form').reset();
  $('date-form').reset();
  clearTimeResult();
  $('timestamp-input').focus();
});
for (const id of ['timestamp-input', 'timestamp-unit', 'date-input', 'date-zone']) {
  $(id).addEventListener('input', clearTimeResult);
}

const workHoursForm = $('work-hours-form');
const workWeekdays = ['monday', 'tuesday', 'wednesday', 'thursday'];

function describeWorkDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours + ' 小时' + (remainder ? ' ' + remainder + ' 分钟' : '');
}

function clearWorkHoursResult() {
  $('work-hours-result').hidden = true;
  status('work-hours-status');
}

// 先检查表单是否填齐，再把前四天的出勤记录和周五上班时间传给核心方法。
workHoursForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearWorkHoursResult();
  const missingField = workHoursForm.querySelector('input:invalid');
  if (missingField) {
    status('work-hours-status', '请填写有效的' + missingField.getAttribute('aria-label') + '。', true);
    missingField.focus();
    return;
  }

  const data = new FormData(workHoursForm);
  const workdays = workWeekdays.map((day) => ({
    start: data.get(day + '-start'),
    end: data.get(day + '-end'),
  }));
  try {
    const { completed, remaining, departure } = toolkitCore.calculateFridayDeparture(workdays, data.get('friday-start'));
    $('work-hours-completed').textContent = describeWorkDuration(completed);
    $('work-hours-remaining').textContent = describeWorkDuration(remaining);
    $('work-hours-departure').textContent = departure === null
      ? '周五当天无法凑满 40 小时'
      : String(Math.floor(departure / 60)).padStart(2, '0') + ':' + String(departure % 60).padStart(2, '0');
    $('work-hours-result').hidden = false;
  } catch (error) {
    status('work-hours-status', error.message, true);
  }
});
workHoursForm.addEventListener('input', clearWorkHoursResult);
workHoursForm.addEventListener('reset', clearWorkHoursResult);
$('work-hours-example').addEventListener('click', () => {
  const departures = ['19:05', '19:00', '19:10', '19:15'];
  for (const [index, day] of workWeekdays.entries()) {
    workHoursForm.elements.namedItem(day + '-start').value = '09:30';
    workHoursForm.elements.namedItem(day + '-end').value = departures[index];
  }
  workHoursForm.elements.namedItem('friday-start').value = '09:30';
  workHoursForm.requestSubmit();
});

const unicodeInput = $('unicode-input');
const unicodeOutput = $('unicode-output');
const unicodeCopy = document.querySelector('[data-copy="unicode-output"]');
const unicodeActions = document.querySelectorAll('[data-unicode]');

function selectUnicodeAction(mode) {
  for (const button of unicodeActions) {
    button.setAttribute('aria-pressed', String(button.dataset.unicode === mode));
  }
}

function clearUnicodeOutput() {
  unicodeOutput.textContent = '';
  unicodeCopy.disabled = true;
  status('unicode-status');
}

// 四种按钮通过 data-unicode 传入模式，aria-pressed 用于保留当前选中样式。
function runUnicode(mode) {
  selectUnicodeAction(mode);
  clearUnicodeOutput();
  try {
    unicodeOutput.textContent = toolkitCore.convertUnicode(unicodeInput.value, mode);
    unicodeCopy.disabled = false;
    status('unicode-status', '转换完成。');
  } catch (error) {
    status('unicode-status', error.message, true);
  }
}

for (const button of unicodeActions) {
  button.addEventListener('click', () => runUnicode(button.dataset.unicode));
}
unicodeInput.addEventListener('input', clearUnicodeOutput);
$('unicode-example').addEventListener('click', () => {
  unicodeInput.value = '\\u4E2D\\u6587\\u0020\\uD83D\\uDE00';
  runUnicode('decode');
});
$('unicode-clear').addEventListener('click', () => {
  unicodeInput.value = '';
  selectUnicodeAction();
  clearUnicodeOutput();
  unicodeInput.focus();
});

const qrTool = $('tool-qr-extract');
const qrFile = $('qr-file');
const qrPreview = $('qr-preview');
const qrOutput = $('qr-output');
const qrCopy = document.querySelector('[data-copy="qr-output"]');
const qrClear = $('qr-clear');
let qrImageUrl;

// 更换或清除图片时释放旧的 Blob URL，并清空对应的预览和结果。
function clearQrResult() {
  if (qrImageUrl) URL.revokeObjectURL(qrImageUrl);
  qrImageUrl = undefined;
  qrPreview.hidden = true;
  qrPreview.removeAttribute('src');
  qrOutput.hidden = true;
  qrOutput.textContent = '';
  $('qr-empty').hidden = false;
  qrCopy.disabled = true;
  status('qr-status');
}

// 将图片画进 Canvas 后取出 RGBA 像素交给 jsQR。限制画布边长和总像素以控制开销。
function decodeQrImage(image) {
  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return window.jsQR(data, canvas.width, canvas.height);
}

async function recognizeQrFile(file) {
  clearQrResult();
  qrClear.disabled = !file;
  if (!file) return;

  const url = URL.createObjectURL(file);
  qrImageUrl = url;
  status('qr-status', '正在识别二维码…');
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    if (qrImageUrl === url) {
      clearQrResult();
      status('qr-status', '无法读取这张图片，请尝试 PNG、JPEG 或 WebP。', true);
    }
    return;
  }
  // 异步解码期间可能选了另一张图，因此只展示当前 URL 对应的结果。
  if (qrImageUrl !== url) return;

  qrPreview.src = url;
  qrPreview.hidden = false;
  if (typeof window.jsQR !== 'function') {
    status('qr-status', '二维码识别组件加载失败，请重新打开页面。', true);
    return;
  }
  try {
    const code = decodeQrImage(image);
    if (!code) {
      status('qr-status', '未识别到二维码，请尝试更清晰或裁剪后的图片。', true);
      return;
    }
    qrOutput.textContent = code.data;
    qrOutput.hidden = false;
    $('qr-empty').hidden = true;
    qrCopy.disabled = false;
    status('qr-status', '已识别二维码。');
  } catch {
    status('qr-status', '无法读取图片像素，请尝试另一张图片。', true);
  }
}

// 选择文件和粘贴图片共用识别流程。二维码工具显示时才从剪贴板提取图片。
qrFile.addEventListener('change', () => recognizeQrFile(qrFile.files[0]));
document.addEventListener('paste', (event) => {
  if (qrTool.hidden || !event.clipboardData) return;
  const { files, items } = event.clipboardData;
  const image = Array.from(files).find((file) => file.type.startsWith('image/'))
    ?? Array.from(items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
  if (!image) {
    status('qr-status', '剪贴板里没有可识别的图片，请复制图片或截图后再粘贴。', true);
    return;
  }

  event.preventDefault();
  qrFile.value = '';
  recognizeQrFile(image);
});
qrClear.addEventListener('click', () => {
  qrFile.value = '';
  clearQrResult();
  qrClear.disabled = true;
  qrFile.focus();
});

async function copyText(value) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Clipboard API 不可用时，下面会尝试选中临时文本框并复制，兼容本地预览。
  }
  const previousFocus = document.activeElement;
  const field = makeElement('textarea', '', value);
  field.readOnly = true;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand('copy')) throw new Error('无法自动复制，请手动选择结果。');
  } finally {
    field.remove();
    previousFocus?.focus();
  }
}

// data-copy 对应要读取的元素 ID，各工具复用同一套复制和反馈逻辑。
for (const button of document.querySelectorAll('[data-copy]')) {
  let timer;
  button.addEventListener('click', async () => {
    const target = $(button.dataset.copy);
    const value = target.value ?? target.textContent;
    try {
      await copyText(value);
      button.textContent = '已复制';
    } catch {
      button.textContent = '请手动复制';
    }
    clearTimeout(timer);
    timer = setTimeout(() => { button.textContent = '复制'; }, 1500);
  });
}
