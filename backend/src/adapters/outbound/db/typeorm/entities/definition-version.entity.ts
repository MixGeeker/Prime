import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { DefinitionEntity } from './definition.entity';

/**
 * definition_versions 表：发布版本（冻结、append-only）。
 *
 * 约束：
 * - `(definition_id, version)` 作为复合主键
 * - 发布后不可更新；如需改动必须发布新版本
 */
@Entity({ name: 'definition_versions' })
export class DefinitionVersionEntity {
  @PrimaryColumn({ name: 'definition_id', type: 'text' })
  definitionId!: string;

  @ManyToOne(() => DefinitionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'definition_id' })
  definition!: DefinitionEntity;

  @PrimaryColumn({ name: 'version', type: 'int' })
  version!: number;

  @Column({ name: 'status', type: 'text' })
  status!: string;

  @Column({ name: 'definition_hash', type: 'text' })
  definitionHash!: string;

  @Column({ name: 'content_json', type: 'jsonb' })
  contentJson!: Record<string, unknown>;

  @Column({ name: 'output_schema_json', type: 'jsonb', nullable: true })
  outputSchemaJson!: Record<string, unknown> | null;

  @Column({ name: 'runner_config_json', type: 'jsonb', nullable: true })
  runnerConfigJson!: Record<string, unknown> | null;

  @Column({ name: 'changelog', type: 'text', nullable: true })
  changelog!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  @Column({ name: 'published_by', type: 'text', nullable: true })
  publishedBy!: string | null;

  @Column({ name: 'deprecated_at', type: 'timestamptz', nullable: true })
  deprecatedAt!: Date | null;

  @Column({ name: 'deprecated_reason', type: 'text', nullable: true })
  deprecatedReason!: string | null;
}
