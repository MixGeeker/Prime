import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * definitions 表：
 * - 保存 definitionId（稳定标识）与最新发布物指针（latestDefinitionHash）
 * - 可执行内容在 definition_releases（发布物）中
 */
@Entity({ name: 'definitions' })
export class DefinitionEntity {
  @PrimaryColumn({ name: 'definition_id', type: 'text' })
  definitionId!: string;

  @Column({ name: 'latest_definition_hash', type: 'text', nullable: true })
  latestDefinitionHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
