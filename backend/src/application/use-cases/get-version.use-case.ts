import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';
import { UseCaseError } from './use-case.error';

@Injectable()
export class GetVersionUseCase {
  constructor(
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
  ) {}

  async execute(definitionId: string, version: number) {
    const found = await this.versionRepository.getVersion(
      definitionId,
      version,
    );
    if (!found) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition version not found: ${definitionId}@${version}`,
      );
    }

    return {
      definitionId: found.definitionId,
      version: found.version,
      status: found.status,
      definitionHash: found.definitionHash,
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
