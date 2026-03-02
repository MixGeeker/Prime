import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DefinitionEntity } from './definition.entity';

/**
 * definition_drafts 表：当前草稿（可变）。
 *
 * 注意：
 * - `draft_revision_id` 用于乐观并发（M4 才会真正强制校验）
 * - content/outputSchema/runnerConfig 存 JSONB，便于快速迭代
 */
@Entity({ name: 'definition_drafts' })
export class DefinitionDraftEntity {
  @PrimaryColumn({ name: 'definition_id', type: 'text' })
  definitionId!: string;

  @ManyToOne(() => DefinitionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'definition_id' })
  definition!: DefinitionEntity;

  @Column({ name: 'draft_revision_id', type: 'text' })
  draftRevisionId!: string;

  @Column({ name: 'content_type', type: 'text' })
  contentType!: string;

  @Column({ name: 'content_json', type: 'jsonb' })
  contentJson!: Record<string, unknown>;

  @Column({ name: 'output_schema_json', type: 'jsonb', nullable: true })
  outputSchemaJson!: Record<string, unknown> | null;

  @Column({ name: 'runner_config_json', type: 'jsonb', nullable: true })
  runnerConfigJson!: Record<string, unknown> | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
