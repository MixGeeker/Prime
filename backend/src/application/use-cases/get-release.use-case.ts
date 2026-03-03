/**
 * GetRelease 用例：读取某个发布物（Release）。
 *
 * 用途：diff/回放/审计（Editor 或运维系统）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import { UseCaseError } from './use-case.error';

@Injectable()
export class GetReleaseUseCase {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
  ) {}

  async execute(definitionId: string, definitionHash: string) {
    const found = await this.releaseRepository.getRelease(
      definitionId,
      definitionHash,
    );
    if (!found) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition release not found: ${definitionId}@${definitionHash}`,
      );
    }

    return {
      definitionId: found.definitionId,
      definitionHash: found.definitionHash,
      status: found.status,
      contentType: 'graph_json' as const,
      content: found.content,
      outputSchema: found.outputSchema,
      runnerConfig: found.runnerConfig,
      changelog: found.changelog,
      publishedAt: found.publishedAt.toISOString(),
      publishedBy: found.publishedBy,
      deprecatedAt: found.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: found.deprecatedReason,
    };
  }
}
