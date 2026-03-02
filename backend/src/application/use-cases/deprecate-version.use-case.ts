import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';
import { UseCaseError } from './use-case.error';

export interface DeprecateVersionCommand {
  definitionId: string;
  version: number;
  reason?: string;
}

@Injectable()
export class DeprecateVersionUseCase {
  constructor(
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
  ) {}

  async execute(command: DeprecateVersionCommand) {
    const version = await this.versionRepository.getVersion(
      command.definitionId,
      command.version,
    );
    if (!version) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition version not found: ${command.definitionId}@${command.version}`,
      );
    }

    const deprecated = await this.versionRepository.deprecateVersion({
      definitionId: command.definitionId,
      version: command.version,
      reason: command.reason ?? null,
      deprecatedAt: new Date(),
    });
    if (!deprecated) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition version not found: ${command.definitionId}@${command.version}`,
      );
    }

    return {
      definitionId: deprecated.definitionId,
      version: deprecated.version,
      status: deprecated.status,
      deprecatedAt: deprecated.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: deprecated.deprecatedReason,
    };
  }
}
