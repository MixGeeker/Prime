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
import type { GraphJsonV2 } from '../validation/graph-json.types';

function run() {
  // 1) JCS：对象键顺序不影响 canonical 输出
  assert.strictEqual(
    jcsCanonicalize({ b: 1, a: 2 }),
    '{"a":2,"b":1}',
    'JCS should sort object keys',
  );

  const hashing = new HashingService();

  // 2) definitionHash：同语义不同顺序 / metadata-resolvers 不参与哈希
  const graphA: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_add', nodeType: 'math.add' },
      {
        id: 'n_start',
        nodeType: 'flow.start',
        params: {
          dynamicOutputs: [
            { name: 'b', valueType: 'Decimal', defaultValue: '01.00' },
            { name: 'a', valueType: 'Decimal', required: true },
          ],
        },
      },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'sum', valueType: 'Decimal' }] },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_start', port: 'b' },
        to: { nodeId: 'n_add', port: 'b' },
      },
      {
        from: { nodeId: 'n_start', port: 'a' },
        to: { nodeId: 'n_add', port: 'a' },
      },
      {
        from: { nodeId: 'n_add', port: 'value' },
        to: { nodeId: 'n_end', port: 'sum' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
      },
    ],
    metadata: { editor: { x: 1 } },
    resolvers: { any: 'thing' },
  };

  const graphB: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'sum', valueType: 'Decimal' }] },
      },
      { id: 'n_add', nodeType: 'math.add' },
      {
        id: 'n_start',
        nodeType: 'flow.start',
        params: {
          dynamicOutputs: [
            { name: 'a', valueType: 'Decimal', required: true },
            { name: 'b', valueType: 'Decimal', defaultValue: '1' },
          ],
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_start', port: 'a' },
        to: { nodeId: 'n_add', port: 'a' },
      },
      {
        from: { nodeId: 'n_start', port: 'b' },
        to: { nodeId: 'n_add', port: 'b' },
      },
      {
        from: { nodeId: 'n_add', port: 'value' },
        to: { nodeId: 'n_end', port: 'sum' },
      },
    ],
    execEdges: [
      {
        from: { nodeId: 'n_start', port: 'out' },
        to: { nodeId: 'n_end', port: 'in' },
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
  const graphInputs: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      {
        id: 'n_start',
        nodeType: 'flow.start',
        params: {
          dynamicOutputs: [
            { name: 'amount', valueType: 'Decimal', required: true },
            { name: 'ratio', valueType: 'Ratio', defaultValue: '0.5000' },
          ],
        },
      },
      { id: 'n_end', nodeType: 'flow.end', params: { dynamicInputs: [] } },
    ],
    edges: [],
    execEdges: [],
  };

  const inputsDefault = hashing.buildInputsSnapshot(
    graphInputs,
    { amount: '01.2300' },
    { decimal: { precision: 10, roundingMode: 'HALF_UP' } },
  );
  if (!inputsDefault.ok) {
    throw new Error(inputsDefault.message);
  }
  assert.deepStrictEqual(inputsDefault.inputs, {
    amount: '1.23',
    ratio: '0.5',
  });

  const inputsOverride = hashing.buildInputsSnapshot(
    graphInputs,
    { amount: '1.23', ratio: '0.25' },
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
  const graphOutputs: GraphJsonV2 = {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      {
        id: 'n_end',
        nodeType: 'flow.end',
        params: { dynamicInputs: [{ name: 'amount', valueType: 'Decimal' }] },
      },
    ],
    edges: [],
    execEdges: [],
  };
  const outputsSnapshot = hashing.buildOutputsSnapshot(graphOutputs, {
    amount: '01.2300',
  });
  if (!outputsSnapshot.ok) {
    throw new Error(outputsSnapshot.message);
  }
  assert.deepStrictEqual(outputsSnapshot.outputs, { amount: '1.23' });

  // 5) Golden 预期值（用于跨语言对账）
  const expected = {
    definitionHash:
      '607562104487a271c536ef9cfbc7de327a7a4c70034621e7a000ae24a7cae35e',
    inputsHashDefault:
      'abcedc56dea605bc0d855e01b70150ca8f1b68c80b2c67ab23f28d0ef06a1ea9',
    inputsHashOverride:
      'c77e0ae01acd91ad646b39482d6a8a77d0212ef3e3dde2e45e6100755ae9d0f3',
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
