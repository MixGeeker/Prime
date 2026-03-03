import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_REPOSITORY,
  type DefinitionListCursor,
  type DefinitionRepositoryPort,
} from '../ports/definition-repository.port';

export interface ListDefinitionsQuery {
  q?: string | null;
  limit: number;
  cursor?: DefinitionListCursor | null;
}

@Injectable()
export class ListDefinitionsUseCase {
  constructor(
    @Inject(DEFINITION_REPOSITORY)
    private readonly definitionRepository: DefinitionRepositoryPort,
  ) {}

  async execute(query: ListDefinitionsQuery) {
    const limit = Math.max(1, Math.min(query.limit, 200));

    const itemsPlusOne = await this.definitionRepository.listDefinitions({
      q: query.q ?? null,
      limit: limit + 1,
      cursor: query.cursor ?? null,
    });

    if (itemsPlusOne.length <= limit) {
      return {
        items: itemsPlusOne,
        nextCursor: null as DefinitionListCursor | null,
      };
    }

    const items = itemsPlusOne.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: {
        updatedAt: last.updatedAt,
        definitionId: last.definitionId,
      } satisfies DefinitionListCursor,
    };
  }
}
