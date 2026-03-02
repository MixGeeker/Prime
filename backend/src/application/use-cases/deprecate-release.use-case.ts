import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import { UseCaseError } from './use-case.error';

export interface DeprecateReleaseCommand {
  definitionId: string;
  definitionHash: string;
  reason?: string;
}

@Injectable()
export class DeprecateReleaseUseCase {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
  ) {}

  async execute(command: DeprecateReleaseCommand) {
    const release = await this.releaseRepository.getRelease(
      command.definitionId,
      command.definitionHash,
    );
    if (!release) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition release not found: ${command.definitionId}@${command.definitionHash}`,
      );
    }

    const deprecated = await this.releaseRepository.deprecateRelease({
      definitionId: command.definitionId,
      definitionHash: command.definitionHash,
      reason: command.reason ?? null,
      deprecatedAt: new Date(),
    });
    if (!deprecated) {
      throw new UseCaseError(
        'DEFINITION_NOT_FOUND',
        `definition release not found: ${command.definitionId}@${command.definitionHash}`,
      );
    }

    return {
      definitionId: deprecated.definitionId,
      definitionHash: deprecated.definitionHash,
      status: deprecated.status,
      deprecatedAt: deprecated.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: deprecated.deprecatedReason,
    };
  }
}

