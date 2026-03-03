/**
 * Hashing golden cases（跨语言对账向量）。
 *
 * 用途：
 * - 固化 `definitionHash/inputsHash/outputsHash` 的预期结果
 * - 作为跨语言实现（例如 Go/Java/Rust）的验收基准
 */
import * as assert from 'node:assert';
import { HashingService } from './hashing.service';
import { jcsCanonicalize } from './jcs';
import type { GraphJsonV1, GraphOutput } from '../validation/graph-json.types';

function run() {
  // 1) JCS：对象键顺序不影响 canonical 输出
  assert.strictEqual(
    jcsCanonicalize({ b: 1, a: 2 }),
    '{"a":2,"b":1}',
    'JCS should sort object keys',
  );

  const hashing = new HashingService();

  // 2) definitionHash：同语义不同顺序 / metadata-resolvers 不参与哈希
  const graphA: GraphJsonV1 = {
    globals: [
      { name: 'b', valueType: 'Decimal', default: '01.00' },
      { name: 'a', valueType: 'Decimal', required: true },
    ],
    entrypoints: [
      {
        key: 'main',
        params: [],
        to: { nodeId: 'n_start', port: 'in' },
      },
    ],
    locals: [],
    nodes: [
      { id: 'n_add', nodeType: 'math.add' },
      { id: 'n_a', nodeType: 'inputs.globals.decimal', params: { name: 'a' } },
      { id: 'n_b', nodeType: 'inputs.globals.decimal', params: { name: 'b' } },
      { id: 'n_out', nodeType: 'outputs.set.decimal', params: { key: 'sum' } },
      { id: 'n_end', nodeType: 'flow.noop' },
      { id: 'n_return', nodeType: 'flow.return' },
      { id: 'n_start', nodeType: 'flow.noop' },
    ],
    edges: [
      {
        from: { nodeId: 'n_b', port: 'value' },
        to: { nodeId: 'n_add', port: 'b' },
      },
      {
        from: { nodeId: 'n_a', port: 'value' },
        to: { nodeId: 'n_add', port: 'a' },
      },
      {
        from: { nodeId: 'n_add', port: 'value' },
        to: { nodeId: 'n_out', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
      {
        from: { nodeId: 'n_end', port: 'out' },
        to: { nodeId: 'n_out', port: 'in' },
      },
      {
        from: { nodeId: 'n_out', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'sum',
        valueType: 'Decimal',
      },
    ],
    metadata: { editor: { x: 1 } },
    resolvers: { any: 'thing' },
  };

  const graphB: GraphJsonV1 = {
    globals: [
      { name: 'a', valueType: 'Decimal', required: true },
      { name: 'b', valueType: 'Decimal', default: '1' },
    ],
    entrypoints: [
      {
        key: 'main',
        params: [],
        to: { nodeId: 'n_start', port: 'in' },
      },
    ],
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.noop' },
      { id: 'n_return', nodeType: 'flow.return' },
      { id: 'n_end', nodeType: 'flow.noop' },
      { id: 'n_b', nodeType: 'inputs.globals.decimal', params: { name: 'b' } },
      { id: 'n_a', nodeType: 'inputs.globals.decimal', params: { name: 'a' } },
      { id: 'n_add', nodeType: 'math.add' },
      { id: 'n_out', nodeType: 'outputs.set.decimal', params: { key: 'sum' } },
    ],
    edges: [
      {
        from: { nodeId: 'n_a', port: 'value' },
        to: { nodeId: 'n_add', port: 'a' },
      },
      {
        from: { nodeId: 'n_b', port: 'value' },
        to: { nodeId: 'n_add', port: 'b' },
      },
      {
        from: { nodeId: 'n_add', port: 'value' },
        to: { nodeId: 'n_out', port: 'value' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
      {
        from: { nodeId: 'n_end', port: 'out' },
        to: { nodeId: 'n_out', port: 'in' },
      },
      {
        from: { nodeId: 'n_out', port: 'out' },
        to: { nodeId: 'n_return', port: 'in' },
      },
    ],
    outputs: [
      {
        key: 'sum',
        valueType: 'Decimal',
      },
    ],
    metadata: { different: true },
    resolvers: { different: true },
  };

  const definitionHashA = hashing.computeDefinitionHash({
    contentType: 'graph_json',
    content: graphA as unknown as Record<string, unknown>,
  });
  const definitionHashB = hashing.computeDefinitionHash({
    contentType: 'graph_json',
    content: graphB as unknown as Record<string, unknown>,
  });
  assert.strictEqual(
    definitionHashA,
    definitionHashB,
    'definitionHash should be stable across ordering/metadata differences',
  );

  // 3) inputsHash：default 生效/不生效 → hash 不同；Decimal/Ratio 规范化一致性
  const graphInputs: GraphJsonV1 = {
    globals: [],
    entrypoints: [
      {
        key: 'main',
        params: [
          { name: 'amount', valueType: 'Decimal', required: true },
          { name: 'ratio', valueType: 'Ratio', default: '0.5000' },
        ],
        to: { nodeId: 'n0', port: 'in' },
      },
    ],
    locals: [],
    nodes: [{ id: 'n0', nodeType: 'flow.return' }],
    edges: [],
    execEdges: [],
    outputs: [],
  };

  const inputsDefault = hashing.buildInputsSnapshot(
    graphInputs,
    { params: { amount: '01.2300' } },
    'main',
    { decimal: { precision: 10, roundingMode: 'HALF_UP' } },
  );
  if (!inputsDefault.ok) {
    throw new Error(inputsDefault.message);
  }
  assert.deepStrictEqual(inputsDefault.params, {
    amount: '1.23',
    ratio: '0.5',
  });

  const inputsOverride = hashing.buildInputsSnapshot(
    graphInputs,
    { params: { amount: '1.23', ratio: '0.25' } },
    'main',
    { decimal: { precision: 10, roundingMode: 'HALF_UP' } },
  );
  if (!inputsOverride.ok) {
    throw new Error(inputsOverride.message);
  }
  assert.notStrictEqual(
    inputsDefault.inputsHash,
    inputsOverride.inputsHash,
    'inputsHash should differ when default is not used',
  );

  // 4) outputsHash：按输出声明排序 + 类型规范化
  const outputsSpec: GraphOutput[] = [
    {
      key: 'amount',
      valueType: 'Decimal',
    },
  ];
  const outputsSnapshot = hashing.buildOutputsSnapshot(outputsSpec, {
    amount: '01.2300',
  });
  if (!outputsSnapshot.ok) {
    throw new Error(outputsSnapshot.message);
  }
  assert.deepStrictEqual(outputsSnapshot.outputs, { amount: '1.23' });

  // 5) Golden 预期值（用于跨语言对账）
  const expected = {
    definitionHash:
      '97edf44ac3548effa504797606b700083784aa51f93ffa913973c45d8d15b47f',
    inputsHashDefault:
      '7335cce14bfc28138f46ee0d56b2d04950b416f69cbaa572a32a2fb57817f56e',
    inputsHashOverride:
      '5b467662debbf39895e63e5150a14e84d9ba8ecfbbd26b8c1b1246f76b437eeb',
    outputsHash:
      'e664f9cc91f28db6b52c743c81c9703eac2f824e7581282be184acfde725da01',
  };

  assert.strictEqual(definitionHashA, expected.definitionHash);
  assert.strictEqual(inputsDefault.inputsHash, expected.inputsHashDefault);
  assert.strictEqual(inputsOverride.inputsHash, expected.inputsHashOverride);
  assert.strictEqual(outputsSnapshot.outputsHash, expected.outputsHash);

  console.log('hashing golden cases: OK');
}

run();
