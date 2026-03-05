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
      {
        id: 'n_get_out',
        nodeType: 'locals.get.decimal',
        params: { name: 'i' },
      },
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

  // 3) Math：新增节点主路径与错误语义
  const graphMathNodes: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_neg', nodeType: 'core.const.decimal', params: { value: '-9' } },
      { id: 'n_three', nodeType: 'core.const.decimal', params: { value: '3' } },
      { id: 'n_five', nodeType: 'core.const.decimal', params: { value: '5' } },
      { id: 'n_eight', nodeType: 'core.const.decimal', params: { value: '8' } },
      { id: 'n_ten', nodeType: 'core.const.decimal', params: { value: '10' } },
      { id: 'n_two', nodeType: 'core.const.decimal', params: { value: '2' } },
      { id: 'n_abs', nodeType: 'math.abs' },
      { id: 'n_min', nodeType: 'math.min' },
      { id: 'n_max', nodeType: 'math.max' },
      { id: 'n_clamp', nodeType: 'math.clamp' },
      { id: 'n_mod', nodeType: 'math.mod' },
      { id: 'n_pow', nodeType: 'math.pow' },
      { id: 'n_sqrt', nodeType: 'math.sqrt' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: {
          dynamicInputs: [
            { name: 'abs', valueType: 'Decimal' },
            { name: 'min', valueType: 'Decimal' },
            { name: 'max', valueType: 'Decimal' },
            { name: 'clamped', valueType: 'Decimal' },
            { name: 'mod', valueType: 'Decimal' },
            { name: 'pow', valueType: 'Decimal' },
            { name: 'sqrt', valueType: 'Decimal' },
          ],
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_neg', port: 'value' },
        to: { nodeId: 'n_abs', port: 'value' },
      },
      {
        from: { nodeId: 'n_abs', port: 'value' },
        to: { nodeId: 'n_end', port: 'abs' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_min', port: 'a' },
      },
      {
        from: { nodeId: 'n_five', port: 'value' },
        to: { nodeId: 'n_min', port: 'b' },
      },
      {
        from: { nodeId: 'n_min', port: 'value' },
        to: { nodeId: 'n_end', port: 'min' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_max', port: 'a' },
      },
      {
        from: { nodeId: 'n_five', port: 'value' },
        to: { nodeId: 'n_max', port: 'b' },
      },
      {
        from: { nodeId: 'n_max', port: 'value' },
        to: { nodeId: 'n_end', port: 'max' },
      },
      {
        from: { nodeId: 'n_ten', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'value' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'min' },
      },
      {
        from: { nodeId: 'n_eight', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'max' },
      },
      {
        from: { nodeId: 'n_clamp', port: 'value' },
        to: { nodeId: 'n_end', port: 'clamped' },
      },
      {
        from: { nodeId: 'n_ten', port: 'value' },
        to: { nodeId: 'n_mod', port: 'a' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_mod', port: 'b' },
      },
      {
        from: { nodeId: 'n_mod', port: 'value' },
        to: { nodeId: 'n_end', port: 'mod' },
      },
      {
        from: { nodeId: 'n_three', port: 'value' },
        to: { nodeId: 'n_pow', port: 'base' },
      },
      {
        from: { nodeId: 'n_two', port: 'value' },
        to: { nodeId: 'n_pow', port: 'exp' },
      },
      {
        from: { nodeId: 'n_pow', port: 'value' },
        to: { nodeId: 'n_end', port: 'pow' },
      },
      {
        from: { nodeId: 'n_abs', port: 'value' },
        to: { nodeId: 'n_sqrt', port: 'value' },
      },
      {
        from: { nodeId: 'n_sqrt', port: 'value' },
        to: { nodeId: 'n_end', port: 'sqrt' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outMathNodes = runner.run({
    content: graphMathNodes as unknown as Record<string, unknown>,
    inputs: {},
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outMathNodes, {
    abs: '9',
    min: '3',
    max: '5',
    clamped: '8',
    mod: '1',
    pow: '9',
    sqrt: '3',
  });

  const graphModByZero: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_ten', nodeType: 'core.const.decimal', params: { value: '10' } },
      { id: 'n_zero', nodeType: 'core.const.decimal', params: { value: '0' } },
      { id: 'n_mod', nodeType: 'math.mod' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_ten', port: 'value' },
        to: { nodeId: 'n_mod', port: 'a' },
      },
      {
        from: { nodeId: 'n_zero', port: 'value' },
        to: { nodeId: 'n_mod', port: 'b' },
      },
      {
        from: { nodeId: 'n_mod', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphModByZero as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.mod should fail on zero divisor',
  );

  const graphSqrtNegative: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_neg', nodeType: 'core.const.decimal', params: { value: '-1' } },
      { id: 'n_sqrt', nodeType: 'math.sqrt' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_neg', port: 'value' },
        to: { nodeId: 'n_sqrt', port: 'value' },
      },
      {
        from: { nodeId: 'n_sqrt', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphSqrtNegative as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.sqrt should fail on negative input',
  );

  const graphClampInvalidRange: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_value', nodeType: 'core.const.decimal', params: { value: '4' } },
      { id: 'n_min', nodeType: 'core.const.decimal', params: { value: '5' } },
      { id: 'n_max', nodeType: 'core.const.decimal', params: { value: '3' } },
      { id: 'n_clamp', nodeType: 'math.clamp' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'value' },
      },
      {
        from: { nodeId: 'n_min', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'min' },
      },
      {
        from: { nodeId: 'n_max', port: 'value' },
        to: { nodeId: 'n_clamp', port: 'max' },
      },
      {
        from: { nodeId: 'n_clamp', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphClampInvalidRange as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.clamp should fail when min is greater than max',
  );

  const graphPowInvalidDomain: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_base', nodeType: 'core.const.decimal', params: { value: '-1' } },
      { id: 'n_exp', nodeType: 'core.const.decimal', params: { value: '0.5' } },
      { id: 'n_pow', nodeType: 'math.pow' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_base', port: 'value' },
        to: { nodeId: 'n_pow', port: 'base' },
      },
      {
        from: { nodeId: 'n_exp', port: 'value' },
        to: { nodeId: 'n_pow', port: 'exp' },
      },
      {
        from: { nodeId: 'n_pow', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphPowInvalidDomain as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.pow should fail on invalid domain',
  );

  // 4) Math（二批）：新增节点主路径与错误语义
  const graphMathNodesV2: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_value_round',
        nodeType: 'core.const.decimal',
        params: { value: '1.234' },
      },
      {
        id: 'n_value_trunc',
        nodeType: 'core.const.decimal',
        params: { value: '-1.239' },
      },
      {
        id: 'n_value_pct',
        nodeType: 'core.const.decimal',
        params: { value: '200' },
      },
      {
        id: 'n_percent',
        nodeType: 'core.const.decimal',
        params: { value: '15' },
      },
      {
        id: 'n_old',
        nodeType: 'core.const.decimal',
        params: { value: '80' },
      },
      {
        id: 'n_new',
        nodeType: 'core.const.decimal',
        params: { value: '100' },
      },
      {
        id: 'n_sign_in',
        nodeType: 'core.const.decimal',
        params: { value: '-9' },
      },
      {
        id: 'n_log_value',
        nodeType: 'core.const.decimal',
        params: { value: '8' },
      },
      {
        id: 'n_log_base',
        nodeType: 'core.const.decimal',
        params: { value: '2' },
      },
      {
        id: 'n_exp_input',
        nodeType: 'core.const.decimal',
        params: { value: '1' },
      },
      { id: 'n_ceil', nodeType: 'math.ceil', params: { scale: 2 } },
      { id: 'n_floor', nodeType: 'math.floor', params: { scale: 2 } },
      { id: 'n_trunc', nodeType: 'math.trunc', params: { scale: 2 } },
      { id: 'n_percentage', nodeType: 'math.percentage_of' },
      { id: 'n_percent_change', nodeType: 'math.percent_change' },
      { id: 'n_sign', nodeType: 'math.sign' },
      { id: 'n_log', nodeType: 'math.log' },
      { id: 'n_exp', nodeType: 'math.exp' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: {
          dynamicInputs: [
            { name: 'ceil', valueType: 'Decimal' },
            { name: 'floor', valueType: 'Decimal' },
            { name: 'trunc', valueType: 'Decimal' },
            { name: 'percentage', valueType: 'Decimal' },
            { name: 'percent_change', valueType: 'Decimal' },
            { name: 'sign', valueType: 'Decimal' },
            { name: 'log', valueType: 'Decimal' },
            { name: 'exp', valueType: 'Decimal' },
          ],
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value_round', port: 'value' },
        to: { nodeId: 'n_ceil', port: 'value' },
      },
      {
        from: { nodeId: 'n_ceil', port: 'value' },
        to: { nodeId: 'n_end', port: 'ceil' },
      },
      {
        from: { nodeId: 'n_value_round', port: 'value' },
        to: { nodeId: 'n_floor', port: 'value' },
      },
      {
        from: { nodeId: 'n_floor', port: 'value' },
        to: { nodeId: 'n_end', port: 'floor' },
      },
      {
        from: { nodeId: 'n_value_trunc', port: 'value' },
        to: { nodeId: 'n_trunc', port: 'value' },
      },
      {
        from: { nodeId: 'n_trunc', port: 'value' },
        to: { nodeId: 'n_end', port: 'trunc' },
      },
      {
        from: { nodeId: 'n_value_pct', port: 'value' },
        to: { nodeId: 'n_percentage', port: 'value' },
      },
      {
        from: { nodeId: 'n_percent', port: 'value' },
        to: { nodeId: 'n_percentage', port: 'percent' },
      },
      {
        from: { nodeId: 'n_percentage', port: 'value' },
        to: { nodeId: 'n_end', port: 'percentage' },
      },
      {
        from: { nodeId: 'n_old', port: 'value' },
        to: { nodeId: 'n_percent_change', port: 'old' },
      },
      {
        from: { nodeId: 'n_new', port: 'value' },
        to: { nodeId: 'n_percent_change', port: 'new' },
      },
      {
        from: { nodeId: 'n_percent_change', port: 'value' },
        to: { nodeId: 'n_end', port: 'percent_change' },
      },
      {
        from: { nodeId: 'n_sign_in', port: 'value' },
        to: { nodeId: 'n_sign', port: 'value' },
      },
      {
        from: { nodeId: 'n_sign', port: 'value' },
        to: { nodeId: 'n_end', port: 'sign' },
      },
      {
        from: { nodeId: 'n_log_value', port: 'value' },
        to: { nodeId: 'n_log', port: 'value' },
      },
      {
        from: { nodeId: 'n_log_base', port: 'value' },
        to: { nodeId: 'n_log', port: 'base' },
      },
      {
        from: { nodeId: 'n_log', port: 'value' },
        to: { nodeId: 'n_end', port: 'log' },
      },
      {
        from: { nodeId: 'n_exp_input', port: 'value' },
        to: { nodeId: 'n_exp', port: 'value' },
      },
      {
        from: { nodeId: 'n_exp', port: 'value' },
        to: { nodeId: 'n_end', port: 'exp' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  const outMathNodesV2 = runner.run({
    content: graphMathNodesV2 as unknown as Record<string, unknown>,
    inputs: {},
    runnerConfig: null,
    options: {},
  }).outputs;
  assert.deepStrictEqual(outMathNodesV2, {
    ceil: '1.24',
    floor: '1.23',
    trunc: '-1.23',
    percentage: '30',
    percent_change: '25',
    sign: '-1',
    log: '3',
    exp: '2.7182818284590452354',
  });

  const graphPercentChangeOldZero: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_old', nodeType: 'core.const.decimal', params: { value: '0' } },
      { id: 'n_new', nodeType: 'core.const.decimal', params: { value: '10' } },
      { id: 'n_change', nodeType: 'math.percent_change' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_old', port: 'value' },
        to: { nodeId: 'n_change', port: 'old' },
      },
      {
        from: { nodeId: 'n_new', port: 'value' },
        to: { nodeId: 'n_change', port: 'new' },
      },
      {
        from: { nodeId: 'n_change', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphPercentChangeOldZero as unknown as Record<
          string,
          unknown
        >,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.percent_change should fail when old is zero',
  );

  const graphLogInvalidValue: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_value',
        nodeType: 'core.const.decimal',
        params: { value: '0' },
      },
      {
        id: 'n_base',
        nodeType: 'core.const.decimal',
        params: { value: '10' },
      },
      { id: 'n_log', nodeType: 'math.log' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value', port: 'value' },
        to: { nodeId: 'n_log', port: 'value' },
      },
      {
        from: { nodeId: 'n_base', port: 'value' },
        to: { nodeId: 'n_log', port: 'base' },
      },
      {
        from: { nodeId: 'n_log', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphLogInvalidValue as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.log should fail when value is not greater than zero',
  );

  const graphLogInvalidBaseNonPositive: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_value',
        nodeType: 'core.const.decimal',
        params: { value: '10' },
      },
      {
        id: 'n_base',
        nodeType: 'core.const.decimal',
        params: { value: '0' },
      },
      { id: 'n_log', nodeType: 'math.log' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value', port: 'value' },
        to: { nodeId: 'n_log', port: 'value' },
      },
      {
        from: { nodeId: 'n_base', port: 'value' },
        to: { nodeId: 'n_log', port: 'base' },
      },
      {
        from: { nodeId: 'n_log', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphLogInvalidBaseNonPositive as unknown as Record<
          string,
          unknown
        >,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.log should fail when base is not greater than zero',
  );

  const graphLogInvalidBaseOne: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_value',
        nodeType: 'core.const.decimal',
        params: { value: '10' },
      },
      {
        id: 'n_base',
        nodeType: 'core.const.decimal',
        params: { value: '1' },
      },
      { id: 'n_log', nodeType: 'math.log' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value', port: 'value' },
        to: { nodeId: 'n_log', port: 'value' },
      },
      {
        from: { nodeId: 'n_base', port: 'value' },
        to: { nodeId: 'n_log', port: 'base' },
      },
      {
        from: { nodeId: 'n_log', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphLogInvalidBaseOne as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.log should fail when base is one',
  );

  const graphExpOverflow: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_value',
        nodeType: 'core.const.decimal',
        params: { value: '1e20' },
      },
      { id: 'n_exp', nodeType: 'math.exp' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'value', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_value', port: 'value' },
        to: { nodeId: 'n_exp', port: 'value' },
      },
      {
        from: { nodeId: 'n_exp', port: 'value' },
        to: { nodeId: 'n_end', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
  };

  assert.throws(
    () => {
      runner.run({
        content: graphExpOverflow as unknown as Record<string, unknown>,
        inputs: {},
        runnerConfig: null,
        options: {},
      });
    },
    (err) => {
      if (!(err instanceof RunnerExecutionError)) {
        return false;
      }
      return err.code === 'RUNNER_DETERMINISTIC_ERROR';
    },
    'math.exp should fail on non-finite result',
  );

  // 5) call_definition：成功调用子蓝图并映射动态 pins
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

  // 6) call_definition：bundle 缺失应失败（确定性错误）
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

  // 7) maxCallDepth：A->B->C，限制为 1 时应在 B 调用 C 时失败
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
