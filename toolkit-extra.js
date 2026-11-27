'use strict';

// 把已打包的第三方源码与核心工厂装进 Blob Worker，本地 file:// 页面也能离线运行。
const extraWorkerSource = toolkitVendorSource + '\nconst core = (' + createExtraCore.toString() + ')();\n' +
  'onmessage = ({data}) => { try { postMessage({result:core.run(data.kind,data.input)}); }' +
  'catch(error) { postMessage({error: error.message || String(error)}); } };';
const extraWorkerUrl = URL.createObjectURL(new Blob([extraWorkerSource], { type: 'text/javascript' }));
const extraStates = new Map();

function resetExtraResult(route) {
  const previous = extraStates.get(route);
  if (previous) {
    previous.worker?.terminate();
    clearTimeout(previous.timer);
  }
  extraStates.delete(route);
  $(route + '-form').removeAttribute('aria-busy');
  $(route + '-output').value = '';
  document.querySelector('[data-copy="' + route + '-output"]').disabled = true;
  if (route === 'regex') {
    $('regex-replaced').value = '';
    document.querySelector('[data-copy="regex-replaced"]').disabled = true;
  }
  status(route + '-status');
  if (route === 'cron') clearCronPreview();
}

function writeExtraOutput(route, output) {
  $(route + '-output').value = output;
  document.querySelector('[data-copy="' + route + '-output"]').disabled = output === '';
}

function runExtraWorker(route, kind, input, render, state) {
  const worker = new Worker(extraWorkerUrl);
  state.worker = worker;
  const finish = () => {
    worker.terminate();
    clearTimeout(state.timer);
    if (extraStates.get(route) === state) {
      extraStates.delete(route);
      $(route + '-form').removeAttribute('aria-busy');
      return true;
    }
    return false;
  };
  state.timer = setTimeout(() => {
    if (finish()) status(route + '-status', '处理超时，请简化表达式或减少输入后重试。', true);
  }, kind === 'hash' ? 15000 : 4000);
  worker.onmessage = ({ data }) => {
    if (!finish()) return;
    if (data.error) {
      status(route + '-status', data.error, true);
      return;
    }
    render(data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (finish()) status(route + '-status', '本地处理组件运行失败，请重新打开页面。', true);
  };
  worker.postMessage({ kind, input });
}

function urlCodec(source, action) {
  const component = $('url-mode').value === 'component';
  if (action === 'encode') return component ? encodeURIComponent(source) : encodeURI(source);
  return component ? decodeURIComponent(source) : decodeURI(source);
}

function base64Codec(source, action) {
  const urlSafe = $('base64-mode').value === 'url';
  if (action === 'encode') {
    const bytes = new TextEncoder().encode(source);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    const result = btoa(binary);
    return urlSafe ? result.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : result;
  }
  let normalized = source.replace(/\s/g, '');
  const allowed = urlSafe ? /^[\w-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!allowed.test(normalized) || normalized.length % 4 === 1 || (normalized.includes('=') && normalized.length % 4 !== 0)) {
    throw new Error('Base64 格式无效，请检查字符和填充。');
  }
  normalized = normalized.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const extraRoutes = ['url-codec', 'base64', 'regex', 'data-convert', 'cron', 'jsonpath', 'hash'];
for (const route of extraRoutes) {
  const form = $(route + '-form');
  form.addEventListener('input', () => resetExtraResult(route));
  form.addEventListener('reset', () => {
    resetExtraResult(route);
    if (route === 'hash') {
      $('hash-file-field').hidden = true;
      $('hash-input').closest('.editor').hidden = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    resetExtraResult(route);
    const source = $(route + '-input')?.value ?? '';
    try {
      if (route === 'url-codec' || route === 'base64') {
        const codec = route === 'url-codec' ? urlCodec : base64Codec;
        const output = codec(source, event.submitter?.value || 'encode');
        writeExtraOutput(route, output);
        status(route + '-status', '已完成' + (event.submitter?.value === 'decode' ? '解码' : '编码') + '。');
        return;
      }
      const state = {};
      extraStates.set(route, state);
      form.setAttribute('aria-busy', 'true');
      status(route + '-status', '正在本地处理…');
      let kind = route;
      let input = { source };
      let render = result => {
        writeExtraOutput(route, result);
        status(route + '-status', '处理完成。');
      };
      if (route === 'data-convert') {
        kind = 'convert';
        input.mode = $('convert-mode').value;
      } else if (route === 'regex') {
        input = { source, pattern: $('regex-pattern').value, flags: $('regex-flags').value, replacement: $('regex-replacement').value };
        render = result => {
          writeExtraOutput(route, JSON.stringify(result.matches, null, 2));
          $('regex-replaced').value = result.replaced;
          document.querySelector('[data-copy="regex-replaced"]').disabled = result.replaced === '';
          status(route + '-status', '找到 ' + result.matches.length + ' 处匹配。' + (result.limited ? '已达到 1000 组展示上限。' : ''));
        };
      } else if (route === 'jsonpath') {
        input.path = $('jsonpath-expression').value;
        render = result => {
          writeExtraOutput(route, result.output);
          status(route + '-status', '查询到 ' + result.count + ' 个结果。');
        };
      } else if (route === 'cron') {
        const timezone = $('cron-timezone').value;
        const date = $('cron-start').value;
        const start = date ? new Date(toolkitCore.parseDate(date, timezone === 'UTC' ? 0 : 480)).toISOString() : undefined;
        input = { expression: $('cron-expression').value, dialect: $('cron-dialect').value, timezone, start };
        render = result => {
          writeExtraOutput(route, result.description + '\n\n下次执行时间（' + timezone + '）\n' + result.next.map((date, i) => date + ' ' + result.weekdays[i]).join('\n'));
          renderCronPreview(result);
          status(route + '-status', '已计算 7 次执行时间。');
        };
      } else if (route === 'hash') {
        if ($('hash-mode').value === 'file') {
          const file = $('hash-file').files[0];
          if (!file) throw new Error('请先选择文件。');
          if (file.size > 50 * 1024 * 1024) throw new Error('请选择不超过 50 MiB 的文件。');
          input = { bytes: await file.arrayBuffer() };
          if (extraStates.get(route) !== state) return;
        }
        render = result => {
          writeExtraOutput(route, Object.entries(result).map(([name, value]) => name.toUpperCase() + '\n' + value).join('\n\n'));
          status(route + '-status', '摘要计算完成。');
        };
      }
      runExtraWorker(route, kind, input, render, state);
    } catch (error) {
      resetExtraResult(route);
      status(route + '-status', error.message || String(error), true);
    }
  });
}

$('hash-mode').addEventListener('change', () => {
  const fileMode = $('hash-mode').value === 'file';
  $('hash-file-field').hidden = !fileMode;
  $('hash-input').closest('.editor').hidden = fileMode;
});

const dataExample = '[{"id":"001","name":"张三","note":"含逗号,和换行\\n示例"},{"id":"002","name":"李四","note":"引号\\"示例"}]';
const examples = {
  'url-codec': () => { $('url-codec-input').value = '中文 空格&value=1'; },
  base64: () => { $('base64-input').value = '你好，Toolkit 😀'; },
  regex: () => {
    $('regex-input').value = '订单-1001 已创建\n订单-1002 待审批';
    $('regex-pattern').value = '订单-(\\d+)';
    $('regex-flags').value = 'g';
    $('regex-replacement').value = 'ORDER-$1';
  },
  'data-convert': () => {
    const mode = $('convert-mode').value;
    const samples = {
      'json-yaml': dataExample, 'json-csv': dataExample,
      'yaml-json': 'name: 工具箱\nitems:\n  - id: "001"\n    enabled: true\n',
      'csv-json': 'id,name,note\r\n001,张三,"含逗号,示例"\r\n002,李四,"第一行\n第二行"',
    };
    $('data-convert-input').value = samples[mode];
  },
  cron: () => {
    $('cron-expression').value = $('cron-dialect').value === 'spring' ? '0 0 9 * * MON-FRI' : '0 9 * * MON-FRI';
    $('cron-start').value = '';
  },
  jsonpath: () => {
    $('jsonpath-input').value = '{"items":[{"id":"001","price":10},{"id":"002","price":25}]}';
    $('jsonpath-expression').value = '$.items[?(@.price > 10)].id';
  },
  hash: () => {
    $('hash-mode').value = 'text';
    $('hash-mode').dispatchEvent(new Event('change'));
    $('hash-input').value = 'abc';
  },
};
for (const [route, example] of Object.entries(examples)) {
  $(route + '-example').addEventListener('click', () => {
    resetExtraResult(route);
    example();
    $(route + '-form').requestSubmit();
  });
}
