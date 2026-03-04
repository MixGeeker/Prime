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
import type { GraphJsonV2 } from '../validation/graph-json.types';
import { RunnerExecutionError } from './runner.error';

function run() {
  const runner = new GraphRunnerService(new NodeCatalogService());

  // 0) Start pins：inputs 注入到 flow.start 的动态 value outputs
  const graphInputs: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      {
        id: 'n_start',
        nodeType: 'flow.start',
        params: { dynamicOutputs: [{ name: 'a', valueType: 'Decimal' }] },
      },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'a', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_start', port: 'a' },
        to: { nodeId: 'n_end', port: 'a' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outInputs = runner.run({
    content: graphInputs as unknown as Record<string, unknown>,
    inputs: { a: '1.5' },
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outInputs, { a: '1.5' });

  // 1) Sequence：out0 必须先于 out1 执行
  const graphSequence: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [{ name: 'x', valueType: 'Decimal', default: '0' }],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_seq', nodeType: 'flow.sequence', params: { count: 2 } },
      { id: 'n_one', nodeType: 'core.const.decimal', params: { value: '1' } },
      { id: 'n_two', nodeType: 'core.const.decimal', params: { value: '2' } },
      { id: 'n_set1', nodeType: 'locals.set.decimal', params: { name: 'x' } },
      { id: 'n_set2', nodeType: 'locals.set.decimal', params: { name: 'x' } },
      { id: 'n_get', nodeType: 'locals.get.decimal', params: { name: 'x' } },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'x', valueType: 'Decimal' }] },
      },
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
      {
        from: { nodeId: 'n_get', port: 'value' },
        to: { nodeId: 'n_end', port: 'x' },
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
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outSequence = runner.run({
    content: graphSequence as unknown as Record<string, unknown>,
    inputs: {},
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outSequence, { x: '2' });

  // 2) While：通过回连实现 3 次迭代后退出
  const graphWhile: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [{ name: 'i', valueType: 'Decimal', default: '0' }],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_while', nodeType: 'flow.while' },
      { id: 'n_get', nodeType: 'locals.get.decimal', params: { name: 'i' } },
      { id: 'n_three', nodeType: 'core.const.decimal', params: { value: '3' } },
      { id: 'n_lt', nodeType: 'compare.decimal.lt' },
      { id: 'n_one', nodeType: 'core.const.decimal', params: { value: '1' } },
      { id: 'n_add', nodeType: 'math.add' },
      { id: 'n_set', nodeType: 'locals.set.decimal', params: { name: 'i' } },
      { id: 'n_get_out', nodeType: 'locals.get.decimal', params: { name: 'i' } },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'i', valueType: 'Decimal' }] },
      },
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
      {
        from: { nodeId: 'n_get_out', port: 'value' },
        to: { nodeId: 'n_end', port: 'i' },
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
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outWhile = runner.run({
    content: graphWhile as unknown as Record<string, unknown>,
    inputs: {},
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outWhile, { i: '3' });

  // 3) call_definition：成功调用子蓝图并映射动态 pins
  const callee: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
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
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: {
          dynamicInputs: [
            { name: 'price', valueType: 'Decimal' },
            { name: 'currency', valueType: 'String' },
          ],
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_price', port: 'value' },
        to: { nodeId: 'n_end', port: 'price' },
      },
      {
        from: { nodeId: 'n_currency', port: 'value' },
        to: { nodeId: 'n_end', port: 'currency' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const root: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
      {
        id: 'n_call',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.callee',
          definitionHash: 'h1',
          calleeInputPins: [],
          calleeOutputPins: [
            { name: 'price', valueType: 'Decimal' },
            { name: 'currency', valueType: 'String' },
          ],
        },
      },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: {
          dynamicInputs: [
            { name: 'price', valueType: 'Decimal' },
            { name: 'currency', valueType: 'String' },
            { name: 'raw', valueType: 'Json' },
          ],
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_call', port: 'price' },
        to: { nodeId: 'n_end', port: 'price' },
      },
      {
        from: { nodeId: 'n_call', port: 'currency' },
        to: { nodeId: 'n_end', port: 'currency' },
      },
      {
        from: { nodeId: 'n_call', port: 'outputs' },
        to: { nodeId: 'n_end', port: 'raw' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call', port: 'in' },
      },
      {
        from: { nodeId: 'n_call', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outCall = runner.run({
    content: root as unknown as Record<string, unknown>,
    inputs: {},
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
        inputs: {},
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
  const graphC: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
      { id: 'n_v', nodeType: 'core.const.decimal', params: { value: '1' } },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'v', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_v', port: 'value' },
        to: { nodeId: 'n_end', port: 'v' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const graphB: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
      {
        id: 'n_call_c',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.C',
          definitionHash: 'hC',
          calleeInputPins: [],
          calleeOutputPins: [{ name: 'v', valueType: 'Decimal' }],
        },
      },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'v', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_call_c', port: 'v' },
        to: { nodeId: 'n_end', port: 'v' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call_c', port: 'in' },
      },
      {
        from: { nodeId: 'n_call_c', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const graphA: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
      {
        id: 'n_call_b',
        nodeType: 'flow.call_definition',
        params: {
          definitionId: 'def.B',
          definitionHash: 'hB',
          calleeInputPins: [],
          calleeOutputPins: [{ name: 'v', valueType: 'Decimal' }],
        },
      },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'v', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_call_b', port: 'v' },
        to: { nodeId: 'n_end', port: 'v' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_call_b', port: 'in' },
      },
      {
        from: { nodeId: 'n_call_b', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphA as unknown as Record<string, unknown>,
        inputs: {},
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
