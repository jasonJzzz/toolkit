'use strict';

const $ = (id) => document.getElementById(id);
const tools = Array.from(document.querySelectorAll('.tool'));
const navigation = Array.from(document.querySelectorAll('.tools-nav a'));
const changeLabels = { added: '新增', removed: '删除', changed: '修改', same: '相同' };

const brandIcon = './assets/tu' + (Math.floor(Math.random() * 3) + 1) + '.jpg';
document.querySelector('link[rel="icon"]').href = brandIcon;
document.querySelector('.brand-icon').src = brandIcon;

function showTool() {
  const route = window.location.hash.slice(1);
  if (route === 'workspace') return;
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

function renderTextDiff() {
  clearComparison('text');
  const { rows, simplified } = toolkitCore.compareText($('text-before').value, $('text-after').value);
  if (!rows.length) {
    status('text-status', '请先输入需要比较的文本。', true);
    return;
  }
  appendSummary('text-summary', ['added', 'removed', 'same'], rows);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const line = makeElement('div', 'line ' + row.type);
    const oldNumber = makeElement('span', 'line-number', row.oldLine);
    const newNumber = makeElement('span', 'line-number', row.newLine);
    const marker = makeElement('span', 'line-marker', { added: '+', removed: '−', same: ' ' }[row.type]);
    if (row.oldLine) oldNumber.setAttribute('aria-label', '原文第 ' + row.oldLine + ' 行');
    if (row.newLine) newNumber.setAttribute('aria-label', '对比文本第 ' + row.newLine + ' 行');
    marker.setAttribute('aria-label', changeLabels[row.type]);
    line.append(oldNumber, newNumber, marker, makeElement('span', 'line-text', row.text));
    fragment.append(line);
  }
  $('text-lines').replaceChildren(fragment);
  $('text-result').hidden = false;
  const message = simplified ? '变动区过长，已按整段替换显示。' : '比较完成。';
  status('text-status', message);
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

const formatEditors = [formatInput, formatOutput];
let editorHeight = '';
const formatResizeObserver = new ResizeObserver((entries) => {
  const resized = entries.find(({ target }) => target.style.height && target.style.height !== editorHeight);
  if (!resized) return;

  editorHeight = resized.target.style.height;
  requestAnimationFrame(() => {
    for (const editor of formatEditors) {
      if (editor.style.height !== editorHeight) editor.style.height = editorHeight;
    }
  });
});
for (const editor of formatEditors) formatResizeObserver.observe(editor);

function refreshFormatCounts() {
  for (const input of [formatInput, formatOutput]) {
    const lines = input.value === '' ? 0 : input.value.split('\n').length;
    $(input.id + '-count').textContent = lines + ' 行 · ' + Array.from(input.value).length + ' 字符';
  }
  formatCopy.disabled = formatOutput.value === '';
}

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

function clearTimeResult() {
  $('timestamp-result').hidden = true;
  status('timestamp-status');
}

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
  $('date-input').value = new Date(time).toISOString();
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

async function copyText(value) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // The selection fallback also supports local files and non-HTTPS previews.
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
