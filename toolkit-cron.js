'use strict';

// Cron 的展示与生成共用原来的 Worker，只生成表达式，不执行或保存服务器任务。
function clearCronPreview() {
  for (const prefix of ['cron', 'cron-builder']) {
    $(prefix + '-times').replaceChildren();
    $(prefix + '-description').textContent = '等待计算；修改输入后请重新计算。';
  }
}
function renderCronPreview(result) {
  for (const prefix of ['cron', 'cron-builder']) {
    $(prefix + '-description').textContent = result.description;
    $(prefix + '-times').replaceChildren(...result.next.map((date, i) => {
      const row = makeElement('li');
      row.append(makeElement('span', 'cron-time-index', String(i + 1).padStart(2, '0')),
        makeElement('time', '', date), makeElement('span', 'cron-weekday', result.weekdays[i]));
      return row;
    }));
  }
}

(() => {
  const definitions = [
    { name: '秒', min: 0, max: 59 }, { name: '分钟', min: 0, max: 59 },
    { name: '小时', min: 0, max: 23 }, { name: '日', min: 1, max: 31 },
    { name: '月', min: 1, max: 12 }, { name: '周', min: 0, max: 7 },
  ];
  let states;
  let active = 1;
  let timer;
  const isSpring = () => $('cron-dialect').value === 'spring';
  const visible = () => definitions.map((_, i) => i).filter(i => isSpring() || i !== 0);
  const defaults = () => ['0', '0', '9', '*', '*', '1-5'];

  // 反解析仅接受生成器可表达的常规语法，先完整校验，再一次性更新配置。
  function parseToken(token, i) {
    const d = definitions[i];
    let value = token.toUpperCase();
    const names = i === 4 ? ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'] : i === 5 ? ['SUN','MON','TUE','WED','THU','FRI','SAT'] : [];
    names.forEach((name, index) => { value = value.replaceAll(name, String(index + (i === 4 ? 1 : 0))); });
    const state = { mode: 'every', from: d.min, to: Math.min(d.min + 1, d.max), step: 1, values: [d.min] };
    const number = text => {
      if (!/^\d+$/.test(text) || +text < d.min || +text > d.max) throw Error(d.name + '字段范围应为 ' + d.min + '–' + d.max + '。');
      return +text;
    };
    if (value === '*') return state;
    if (value === '?' && isSpring() && [3,5].includes(i)) return { ...state, mode: 'unspecified' };
    if (/^\d+-\d+$/.test(value)) {
      const [from,to] = value.split('-').map(number);
      if (from > to) throw Error(d.name + '范围起点不能大于终点。');
      return { ...state, mode: 'range', from, to };
    }
    if (/^(\*|\d+)\/\d+$/.test(value)) {
      const [from, step] = value.split('/');
      if (+step < 1 || +step > d.max - d.min + 1) throw Error(d.name + '步长超出范围。');
      return { ...state, mode: 'step', from: from === '*' ? d.min : number(from), step: +step };
    }
    if (/^\d+(,\d+)*$/.test(value)) return { ...state, mode: 'list', values: [...new Set(value.split(',').map(number))].sort((a,b)=>a-b) };
    throw Error(d.name + '字段暂不能反向载入。支持 *、范围、起点/步长、指定值列表和日期/星期的 ?。');
  }
  function token(state) {
    if (state.mode === 'every') return '*';
    if (state.mode === 'unspecified') return '?';
    if (state.mode === 'range') {
      if (state.from > state.to) throw Error('范围起点不能大于终点。');
      return state.from + '-' + state.to;
    }
    if (state.mode === 'step') return state.from + '/' + state.step;
    if (!state.values.length) throw Error('指定模式至少需要选择一个值。');
    return state.values.join(',');
  }
  function synchronize(compute = true) {
    clearTimeout(timer);
    try {
      const tokens = visible().map(i => token(states[i]));
      // 再经同一反解析校验数值范围，避免空数字框被隐式当成 0。
      visible().forEach((i, n) => parseToken(tokens[n], i));
      const expression = tokens.join(' ');
      $('cron-generated').value = expression;
      document.querySelector('[data-copy="cron-generated"]').disabled = false;
      $('cron-field-values').replaceChildren(...visible().map((i,n) => {
        const cell = makeElement('div'); cell.append(makeElement('span', '', definitions[i].name), makeElement('code', '', tokens[n])); return cell;
      }));
      status('cron-builder-status', compute ? '已生成，将自动计算。' : '修改配置即可自动计算，也可载入已有表达式。');
      if (compute) {
        $('cron-expression').value = expression;
        resetExtraResult('cron');
        timer = setTimeout(() => $('cron-form').requestSubmit(), 220);
      }
    } catch (error) {
      $('cron-generated').value = '';
      document.querySelector('[data-copy="cron-generated"]').disabled = true;
      resetExtraResult('cron');
      status('cron-builder-status', error.message, true);
    }
  }
  function draw() {
    if (!visible().includes(active)) active = 1;
    $('cron-field-tabs').replaceChildren(...visible().map(i => {
      const button = makeElement('button', 'cron-field-tab', definitions[i].name);
      button.type = 'button'; button.id = 'cron-tab-' + i;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(i === active));
      button.setAttribute('aria-controls', 'cron-field-panel'); button.tabIndex = i === active ? 0 : -1;
      button.addEventListener('click', () => { active = i; draw(); $('cron-tab-' + i).focus(); });
      button.addEventListener('keydown', event => {
        const list = visible(); let position = list.indexOf(i);
        if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
        event.preventDefault();
        position = event.key === 'Home' ? 0 : event.key === 'End' ? list.length-1 : (position + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
        active = list[position]; draw(); $('cron-tab-' + active).focus();
      });
      return button;
    }));
    const d = definitions[active], state = states[active], panel = $('cron-field-panel');
    panel.setAttribute('aria-labelledby', 'cron-tab-' + active);
    const modes = [['every','每个值（*）'],['range','范围'],['step','周期／步长'],['list','指定值']];
    if (isSpring() && [3,5].includes(active)) modes.push(['unspecified','不指定（?）']);
    const modeRow = makeElement('div', 'cron-modes');
    modes.forEach(([value,title]) => {
      const label = makeElement('label'); const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'cron-field-mode'; radio.value = value; radio.checked = state.mode === value;
      radio.addEventListener('change', () => {
        state.mode = value; reconcileDay(); draw(); synchronize();
        panel.querySelector('input[name="cron-field-mode"]:checked').focus();
      });
      label.append(radio, document.createTextNode(title)); modeRow.append(label);
    });
    panel.replaceChildren(modeRow);
    const controls = makeElement('div', 'cron-number-controls');
    function numeric(title, key, min, max) {
      const label = makeElement('label', 'extra-field'); label.append(makeElement('span', '', title));
      const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = 1; input.value = state[key];
      input.addEventListener('input', () => { state[key] = input.value === '' ? NaN : Number(input.value); reconcileDay(); synchronize(); });
      label.append(input); controls.append(label);
    }
    if (state.mode === 'range') { numeric('从', 'from', d.min, d.max); numeric('到', 'to', d.min, d.max); }
    if (state.mode === 'step') { numeric('起点', 'from', d.min, d.max); numeric('每隔多少个值', 'step', 1, d.max-d.min+1); }
    panel.append(controls);
    if (state.mode === 'list') {
      const grid = makeElement('div', 'cron-value-grid');
      for (let value = d.min; value <= d.max; value++) {
        const label = makeElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.checked = state.values.includes(value);
        input.addEventListener('change', () => {
          state.values = input.checked ? [...state.values, value].sort((a,b)=>a-b) : state.values.filter(x=>x!==value);
          reconcileDay(); synchronize();
        });
        label.append(input, makeElement('span', '', active === 5 ? ['日(0)','一','二','三','四','五','六','日(7)'][value] : String(value).padStart(2,'0'))); grid.append(label);
      }
      panel.append(grid);
    }
    panel.append(makeElement('p', 'cron-help', d.name + '范围：' + d.min + '–' + d.max + (active === 5 ? '；0 和 7 均为周日。' : '。') + ' 范围包含两端；步长在当前字段内重复，并非跨日累计间隔。'));
  }
  // Spring 的日期/星期保持一项不限制，避免与 Linux OR 规则混用。
  function reconcileDay() {
    if (!isSpring() || ![3,5].includes(active)) return;
    if (!['every','unspecified'].includes(states[active].mode)) {
      states[active === 3 ? 5 : 3].mode = 'unspecified';
    }
  }
  function load(expression, compute) {
    const fields = expression.trim().split(/\s+/), indices = visible();
    if (fields.length !== indices.length) throw Error('当前规则需要 ' + indices.length + ' 个字段，请先选择匹配的规则。');
    const next = states ? states.slice() : definitions.map(()=>null);
    indices.forEach((i,n) => { next[i] = parseToken(fields[n], i); });
    if (!isSpring()) next[0] = parseToken('0',0);
    if (isSpring() && !['every','unspecified'].includes(next[3].mode) && !['every','unspecified'].includes(next[5].mode)) throw Error('Spring 日期与星期至少有一项为 * 或 ?。');
    states = next; draw(); synchronize(compute);
  }
  const presets = [
    ['每分钟',['0','*','*','*','*','*']], ['每5分钟',['0','*/5','*','*','*','*']],
    ['每15分钟',['0','*/15','*','*','*','*']], ['每小时',['0','0','*','*','*','*']],
    ['每天零点',['0','0','0','*','*','*']], ['每天9:30',['0','30','9','*','*','*']],
    ['工作日9点',['0','0','9','*','*','1-5']], ['每周一9点',['0','0','9','*','*','1']],
    ['每月1号',['0','0','0','1','*','*']], ['每年元旦',['0','0','0','1','1','*']],
  ];
  $('cron-presets').replaceChildren(...presets.map(([title, fields]) => {
    const button = makeElement('button','button',title); button.type = 'button';
    button.addEventListener('click', () => load((isSpring()?fields:fields.slice(1)).join(' '),true)); return button;
  }));
  $('cron-builder-import').addEventListener('click', () => {
    try { load($('cron-expression').value,true); } catch(error) { status('cron-builder-status',error.message,true); }
  });
  $('cron-builder-reset').addEventListener('click', () => load((isSpring()?defaults():defaults().slice(1)).join(' '),true));
  $('cron-dialect').addEventListener('change', () => {
    clearTimeout(timer);
    if (isSpring() && !['every','unspecified'].includes(states[3].mode) && !['every','unspecified'].includes(states[5].mode)) states[5].mode = 'unspecified';
    draw(); synchronize(false);
    status('cron-builder-status','规则已切换。载入上方表达式，或修改生成器配置后生成。');
  });
  // 在下方也展示 Worker 的处理中、成功或错误，用户无需滚回页首查找原因。
  new MutationObserver(() => {
    if ($('cron-status').textContent) status('cron-builder-status', $('cron-status').textContent, $('cron-status').classList.contains('error'));
  }).observe($('cron-status'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  // 手工提交、重置或编辑上方输入时，取消尚未执行的自动计算，避免晚到任务覆盖结果。
  $('cron-form').addEventListener('input', () => clearTimeout(timer));
  $('cron-form').addEventListener('submit', () => clearTimeout(timer));
  $('cron-form').addEventListener('reset', () => { clearTimeout(timer); setTimeout(() => load(defaults().join(' '), false),0); });
  load(defaults().join(' '),false);
})();
