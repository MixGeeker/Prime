/**
 * ListReleases 用例：列出某个 definitionId 的所有 releases（含状态/发布时间/changelog）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';

@Injectable()
export class ListReleasesUseCase {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
  ) {}

  async execute(definitionId: string) {
    const releases = await this.releaseRepository.listReleases(definitionId);
    return releases.map((release) => ({
      definitionId: release.definitionId,
      definitionHash: release.definitionHash,
      status: release.status,
      changelog: release.changelog,
      publishedAt: release.publishedAt.toISOString(),
      publishedBy: release.publishedBy,
      deprecatedAt: release.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: release.deprecatedReason,
    }));
  }
}
