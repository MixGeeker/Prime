import * as assert from 'node:assert';
import { HashingService } from './hashing.service';
import { jcsCanonicalize } from './jcs';
import type {
  GraphJsonV1,
  GraphOutput,
  GraphVariable,
} from '../validation/graph-json.types';

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
    schemaVersion: 1,
    variables: [
      { path: 'inputs.params.b', valueType: 'Decimal', default: '01.00' },
      { path: 'inputs.params.a', valueType: 'Decimal', required: true },
    ],
    nodes: [
      { id: 'n2', nodeType: 'math.add', nodeVersion: 1 },
      {
        id: 'n1',
        nodeType: 'core.var.decimal',
        nodeVersion: 1,
        params: { path: 'inputs.params.a' },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n1', port: 'value' },
        to: { nodeId: 'n2', port: 'a' },
      },
      {
        from: { nodeId: 'nX', port: 'value' },
        to: { nodeId: 'n2', port: 'b' },
      },
    ],
    outputs: [
      {
        key: 'sum',
        valueType: 'Decimal',
        from: { nodeId: 'n2', port: 'result' },
      },
    ],
    metadata: { editor: { x: 1 } },
    resolvers: { any: 'thing' },
  };

  const graphB: GraphJsonV1 = {
    schemaVersion: 1,
    variables: [
      { path: 'inputs.params.a', valueType: 'Decimal', required: true },
      { path: 'inputs.params.b', valueType: 'Decimal', default: '1' },
    ],
    nodes: [
      {
        id: 'n1',
        nodeType: 'core.var.decimal',
        nodeVersion: 1,
        params: { path: 'inputs.params.a' },
      },
      { id: 'n2', nodeType: 'math.add', nodeVersion: 1 },
    ],
    edges: [
      {
        from: { nodeId: 'nX', port: 'value' },
        to: { nodeId: 'n2', port: 'b' },
      },
      {
        from: { nodeId: 'n1', port: 'value' },
        to: { nodeId: 'n2', port: 'a' },
      },
    ],
    outputs: [
      {
        key: 'sum',
        valueType: 'Decimal',
        from: { nodeId: 'n2', port: 'result' },
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
  const variables: GraphVariable[] = [
    { path: 'inputs.params.amount', valueType: 'Decimal', required: true },
    { path: 'inputs.params.ratio', valueType: 'Ratio', default: '0.5000' },
  ];

  const inputsDefault = hashing.buildInputsSnapshot(
    variables,
    { params: { amount: '01.2300' } },
    { decimal: { precision: 10, roundingMode: 'HALF_UP' } },
  );
  assert.ok(inputsDefault.ok, inputsDefault.message);
  assert.deepStrictEqual(inputsDefault.variables, {
    'inputs.params.amount': '1.23',
    'inputs.params.ratio': '0.5',
  });

  const inputsOverride = hashing.buildInputsSnapshot(
    variables,
    { params: { amount: '1.23', ratio: '0.25' } },
    { decimal: { precision: 10, roundingMode: 'HALF_UP' } },
  );
  assert.ok(inputsOverride.ok, inputsOverride.message);
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
      from: { nodeId: 'n1', port: 'value' },
    },
  ];
  const outputsSnapshot = hashing.buildOutputsSnapshot(outputsSpec, {
    amount: '01.2300',
  });
  assert.ok(outputsSnapshot.ok, outputsSnapshot.message);
  assert.deepStrictEqual(outputsSnapshot.outputs, { amount: '1.23' });

  // 5) Golden 预期值（用于跨语言对账）
  const expected = {
    definitionHash:
      '1d61ad81e8d474b4433bd055a1812a053e5e57c6e3536a2e915d87907ef01e8e',
    inputsHashDefault:
      '6f056cee615eef4ecef5edb64ce679fef11b832430dec288280190455cd4baa9',
    inputsHashOverride:
      '78d5f93b6fc425b8ed226115f40016298213ea48ef93f16dfeac569c60d910fa',
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
