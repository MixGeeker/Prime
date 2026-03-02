/**
 * validate 输出的结构化错误（与 `compute-engine/GRAPH_SCHEMA.md` / `API_DESIGN.md` 对齐）。
 */

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  /**
   * JSON Pointer（例如：`/nodes/0/params/path`）。
   * - 用于 Editor 精确定位错误位置
   * - 没有明确定位点时可缺省
   */
  path?: string;
  message: string;
}
