import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * definitions 表：
 * - 仅保存 definitionId（稳定标识）与创建时间
 * - 可执行内容在 definition_versions（发布版本）中
 */
@Entity({ name: 'definitions' })
export class DefinitionEntity {
  @PrimaryColumn({ name: 'definition_id', type: 'text' })
  definitionId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
