import { NODE_IMPLEMENTATIONS_V1 } from '../nodes/v1/registry';
import type { NodeCatalog } from './node-catalog.types';

/**
 * 内置 Node Catalog（schemaVersion=1）。
 *
 * 约定：
 * - Catalog 是引擎的“节点白名单”，Editor 也会依赖它来渲染节点与校验连线。
 * - Catalog 的单一事实来源是 `application/nodes/**` 下的 NodeImplementation（def + evaluate）。
 */
export const NODE_CATALOG_V1: NodeCatalog = {
  schemaVersion: 1,
  nodes: NODE_IMPLEMENTATIONS_V1.map((impl) => impl.def),
};
