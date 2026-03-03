/**
 * Runner golden cases。
 *
 * 用途：用最小图例验证 runner 的关键语义：
 * - Sequence 的确定性顺序（continue_many 调度）
 * - While 回连循环 + limits 防卡死
 * - call_definition 的 bundle 注入 + maxCallDepth
 */
import * as assert from 'node:assert';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import { GraphRunnerService } from './graph-runner.service';
import type { GraphJsonV1 } from '../validation/graph-json.types';
import { RunnerExecutionError } from './runner.error';

function run() {
  const runner = new GraphRunnerService(new NodeCatalogService());

  // 1) Sequence：out0 必须先于 out1 执行
  const graphSequence: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_start', port: 'in' } },
    ],
    locals: [{ name: 'x', valueType: 'Decimal', default: '0' }],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      { id: 'n_seq', nodeType: 'flow.sequence', params: { count: 2 } },
      { id: 'n_one', nodeType: 'core.const.decimal', params: { value: '1' } },
      { id: 'n_two', nodeType: 'core.const.decimal', params: { value: '2' } },
      { id: 'n_set1', nodeType: 'locals.set.decimal', params: { name: 'x' } },
      { id: 'n_set2', nodeType: 'locals.set.decimal', params: { name: 'x' } },
      { id: 'n_get', nodeType: 'locals.get.decimal', params: { name: 'x' } },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [
      {
        from: { nodeId: 'n_one', port: 'value' },
        to: { nodeId: 'n_set1', port: 'value' },
      },
      {
        from: { nodeId: 'n_two', port: 'value' },
        to: { nodeId: 'n_set2', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_seq', port: 'in' },
      },
      {
        from: { nodeId: 'n_seq', port: 'out0' },
        to: { nodeId: 'n_set1', port: 'in' },
      },
      {
        from: { nodeId: 'n_seq', port: 'out1' },
        to: { nodeId: 'n_set2', port: 'in' },
      },
      {
        from: { nodeId: 'n_set2', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'x',
        valueType: 'Decimal',
        from: { nodeId: 'n_get', port: 'value' },
      },
    ],
  };

  const outSequence = runner.run({
    content: graphSequence as unknown as Record<string, unknown>,
    entrypointKey: 'main',
    inputs: { globals: {}, params: {} },
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outSequence, { x: '2' });

  // 2) While：通过回连实现 3 次迭代后退出
  const graphWhile: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_start', port: 'in' } },
    ],
    locals: [{ name: 'i', valueType: 'Decimal', default: '0' }],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      { id: 'n_while', nodeType: 'flow.while' },
      { id: 'n_get', nodeType: 'locals.get.decimal', params: { name: 'i' } },
      { id: 'n_three', nodeType: 'core.const.decimal', params: { value: '3' } },
      { id: 'n_lt', nodeType: 'compare.decimal.lt' },
      { id: 'n_one', nodeType: 'core.const.decimal', params: { value: '1' } },
      { id: 'n_add', nodeType: 'math.add' },
      { id: 'n_set', nodeType: 'locals.set.decimal', params: { name: 'i' } },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [
      {
        from: { nodeId: 'n_get', port: 'value' },
        to: { nodeId: 'n_lt', port: 'a' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_lt', port: 'b' },
      },
      {
        from: { nodeId: 'n_lt', port: 'value' },
        to: { nodeId: 'n_while', port: 'cond' },
      },
      {
        from: { nodeId: 'n_get', port: 'value' },
        to: { nodeId: 'n_add', port: 'a' },
      },
      {
        from: { nodeId: 'n_one', port: 'value' },
        to: { nodeId: 'n_add', port: 'b' },
      },
      {
        from: { nodeId: 'n_add', port: 'value' },
        to: { nodeId: 'n_set', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_while', port: 'in' },
      },
      {
        from: { nodeId: 'n_while', port: 'body' },
        to: { nodeId: 'n_set', port: 'in' },
      },
      {
        from: { nodeId: 'n_set', port: 'out' },
        to: { nodeId: 'n_while', port: 'in' },
      },
      {
        from: { nodeId: 'n_while', port: 'completed' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'i',
        valueType: 'Decimal',
        from: { nodeId: 'n_get', port: 'value' },
      },
    ],
  };

  const outWhile = runner.run({
    content: graphWhile as unknown as Record<string, unknown>,
    entrypointKey: 'main',
    inputs: { globals: {}, params: {} },
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outWhile, { i: '3' });

  // 3) call_definition：成功调用子蓝图并映射强类型槽位
  const callee: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_return', port: 'in' } },
    ],
    locals: [],
    nodes: [
      { id: 'n_return', nodeType: 'flow.return' },
      {
        id: 'n_price',
        nodeType: 'core.const.decimal',
        params: { value: '1.23' },
      },
      {
        id: 'n_currency',
        nodeType: 'core.const.string',
        params: { value: 'USD' },
      },
    ],
    edges: [],
    execEdges: [],
    outputs: [
      {
        key: 'price',
        valueType: 'Decimal',
        from: { nodeId: 'n_price', port: 'value' },
      },
      {
        key: 'currency',
        valueType: 'String',
        from: { nodeId: 'n_currency', port: 'value' },
      },
    ],
  };

  const root: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_start', port: 'in' } },
    ],
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      {
        id: 'n_call',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.callee',
          definitionHash: 'h1',
          exposeOutputs: { decimal: ['price'], string: ['currency'] },
        },
      },
      { id: 'n_globals', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_params', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [
      {
        from: { nodeId: 'n_globals', port: 'value' },
        to: { nodeId: 'n_call', port: 'globals' },
      },
      {
        from: { nodeId: 'n_params', port: 'value' },
        to: { nodeId: 'n_call', port: 'params' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call', port: 'in' },
      },
      {
        from: { nodeId: 'n_call', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'price',
        valueType: 'Decimal',
        from: { nodeId: 'n_call', port: 'decimal0' },
      },
      {
        key: 'currency',
        valueType: 'String',
        from: { nodeId: 'n_call', port: 'string0' },
      },
      {
        key: 'raw',
        valueType: 'Json',
        from: { nodeId: 'n_call', port: 'outputs' },
      },
    ],
  };

  const outCall = runner.run({
    content: root as unknown as Record<string, unknown>,
    entrypointKey: 'main',
    inputs: { globals: {}, params: {} },
    runnerConfig: null,
    options: {},
    definitionBundle: [
      {
        definitionId: 'def.callee',
        definitionHash: 'h1',
        content: callee as unknown as Record<string, unknown>,
        runnerConfig: null,
      },
    ],
  }).outputs;

  assert.strictEqual(outCall['price'], '1.23');
  assert.strictEqual(outCall['currency'], 'USD');
  assert.deepStrictEqual(outCall['raw'], { price: '1.23', currency: 'USD' });

  // 4) call_definition：bundle 缺失应失败（确定性错误）
  assert.throws(
    () => {
      runner.run({
        content: root as unknown as Record<string, unknown>,
        entrypointKey: 'main',
        inputs: { globals: {}, params: {} },
        runnerConfig: null,
        options: {},
        definitionBundle: [],
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'call_definition should fail when dependency bundle is missing',
  );

  // 5) maxCallDepth：A->B->C，限制为 1 时应在 B 调用 C 时失败
  const graphC: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_return', port: 'in' } },
    ],
    locals: [],
    nodes: [
      { id: 'n_return', nodeType: 'flow.return' },
      { id: 'n_v', nodeType: 'core.const.decimal', params: { value: '1' } },
    ],
    edges: [],
    execEdges: [],
    outputs: [
      {
        key: 'v',
        valueType: 'Decimal',
        from: { nodeId: 'n_v', port: 'value' },
      },
    ],
  };

  const graphB: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_start', port: 'in' } },
    ],
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      {
        id: 'n_call_c',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.C',
          definitionHash: 'hC',
          exposeOutputs: { decimal: ['v'] },
        },
      },
      { id: 'n_globals', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_params', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [
      {
        from: { nodeId: 'n_globals', port: 'value' },
        to: { nodeId: 'n_call_c', port: 'globals' },
      },
      {
        from: { nodeId: 'n_params', port: 'value' },
        to: { nodeId: 'n_call_c', port: 'params' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call_c', port: 'in' },
      },
      {
        from: { nodeId: 'n_call_c', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'v',
        valueType: 'Decimal',
        from: { nodeId: 'n_call_c', port: 'decimal0' },
      },
    ],
  };

  const graphA: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      { key: 'main', params: [], to: { nodeId: 'n_start', port: 'in' } },
    ],
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      {
        id: 'n_call_b',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.B',
          definitionHash: 'hB',
          exposeOutputs: { decimal: ['v'] },
        },
      },
      { id: 'n_globals', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_params', nodeType: 'core.const.json', params: { value: {} } },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [
      {
        from: { nodeId: 'n_globals', port: 'value' },
        to: { nodeId: 'n_call_b', port: 'globals' },
      },
      {
        from: { nodeId: 'n_params', port: 'value' },
        to: { nodeId: 'n_call_b', port: 'params' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call_b', port: 'in' },
      },
      {
        from: { nodeId: 'n_call_b', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'v',
        valueType: 'Decimal',
        from: { nodeId: 'n_call_b', port: 'decimal0' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphA as unknown as Record<string, unknown>,
        entrypointKey: 'main',
        inputs: { globals: {}, params: {} },
        runnerConfig: { limits: { maxCallDepth: 1 } },
        options: {},
        definitionBundle: [
          {
            definitionId: 'def.B',
            definitionHash: 'hB',
            content: graphB as unknown as Record<string, unknown>,
            runnerConfig: null,
          },
          {
            definitionId: 'def.C',
            definitionHash: 'hC',
            content: graphC as unknown as Record<string, unknown>,
            runnerConfig: null,
          },
        ],
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'maxCallDepth should be enforced across nested calls',
  );

  console.log('runner golden cases: OK');
}

run();
