import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';

@Injectable()
export class ListVersionsUseCase {
  constructor(
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
  ) {}

  async execute(definitionId: string) {
    const versions = await this.versionRepository.listVersions(definitionId);
    return versions.map((version) => ({
      definitionId: version.definitionId,
      version: version.version,
      status: version.status,
      definitionHash: version.definitionHash,
      changelog: version.changelog,
      publishedAt: version.publishedAt.toISOString(),
      publishedBy: version.publishedBy,
      deprecatedAt: version.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: version.deprecatedReason,
    }));
  }
}
