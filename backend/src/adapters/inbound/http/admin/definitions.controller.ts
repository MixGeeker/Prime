/**
 * Admin Definitions HTTP Controller（入站适配器）。
 *
 * 职责：
 * - 提供 Definition 的 draft 管理、validate/dry-run、publish/release 查询等能力
 * - 将 UseCaseError 映射为合适的 HTTP 错误响应
 *
 * 说明：控制器只做“协议/鉴权/错误映射”，业务编排由 application/use-cases 完成。
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateDraftUseCase } from '../../../../application/use-cases/create-draft.use-case';
import { DeleteDraftUseCase } from '../../../../application/use-cases/delete-draft.use-case';
import { DeprecateReleaseUseCase } from '../../../../application/use-cases/deprecate-release.use-case';
import { DryRunUseCase } from '../../../../application/use-cases/dry-run.use-case';
import { GetDraftUseCase } from '../../../../application/use-cases/get-draft.use-case';
import { GetReleaseUseCase } from '../../../../application/use-cases/get-release.use-case';
import { ListDefinitionsUseCase } from '../../../../application/use-cases/list-definitions.use-case';
import { ListReleasesUseCase } from '../../../../application/use-cases/list-releases.use-case';
import { PublishDefinitionUseCase } from '../../../../application/use-cases/publish-definition.use-case';
import { UpdateDraftUseCase } from '../../../../application/use-cases/update-draft.use-case';
import { UseCaseError } from '../../../../application/use-cases/use-case.error';
import { ValidateDefinitionUseCase } from '../../../../application/use-cases/validate-definition.use-case';
import type { DefinitionListCursor } from '../../../../application/ports/definition-repository.port';
import {
  CreateDefinitionDraftDto,
  DeprecateReleaseDto,
  DryRunDto,
  ListDefinitionsQueryDto,
  PublishDefinitionDto,
  UpdateDefinitionDraftDto,
  ValidateDefinitionDto,
} from './dto/definitions.dto';

@Controller('/admin/definitions')
@ApiTags('admin')
export class AdminDefinitionsController {
  constructor(
    private readonly createDraftUseCase: CreateDraftUseCase,
    private readonly getDraftUseCase: GetDraftUseCase,
    private readonly updateDraftUseCase: UpdateDraftUseCase,
    private readonly deleteDraftUseCase: DeleteDraftUseCase,
    private readonly validateDefinitionUseCase: ValidateDefinitionUseCase,
    private readonly dryRunUseCase: DryRunUseCase,
    private readonly publishDefinitionUseCase: PublishDefinitionUseCase,
    private readonly deprecateReleaseUseCase: DeprecateReleaseUseCase,
    private readonly listReleasesUseCase: ListReleasesUseCase,
    private readonly getReleaseUseCase: GetReleaseUseCase,
    private readonly listDefinitionsUseCase: ListDefinitionsUseCase,
  ) {}

  @Get()
  async listDefinitions(@Query() query: ListDefinitionsQueryDto) {
    const cursor = query.cursor ? decodeDefinitionCursor(query.cursor) : null;

    const result = await this.listDefinitionsUseCase.execute({
      q: query.q ?? null,
      limit: query.limit ?? 50,
      cursor,
    });

    return {
      items: result.items,
      nextCursor: result.nextCursor
        ? encodeDefinitionCursor(result.nextCursor)
        : null,
    };
  }

  @Post()
  async createDraft(@Body() body: CreateDefinitionDraftDto) {
    try {
      return await this.createDraftUseCase.execute({
        definitionId: body.definitionId,
        contentType: body.contentType,
        content: body.content,
        outputSchema: body.outputSchema ?? null,
        runnerConfig: body.runnerConfig ?? null,
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Get(':definitionId/draft')
  async getDraft(@Param('definitionId') definitionId: string) {
    try {
      return await this.getDraftUseCase.execute(definitionId);
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Put(':definitionId/draft')
  async updateDraft(
    @Param('definitionId') definitionId: string,
    @Body() body: UpdateDefinitionDraftDto,
  ) {
    try {
      return await this.updateDraftUseCase.execute({
        definitionId,
        draftRevisionId: body.draftRevisionId,
        contentType: body.contentType,
        content: body.content,
        outputSchema: body.outputSchema ?? null,
        runnerConfig: body.runnerConfig ?? null,
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Delete(':definitionId/draft')
  async deleteDraft(@Param('definitionId') definitionId: string) {
    try {
      await this.deleteDraftUseCase.execute(definitionId);
      return {
        deleted: true,
      };
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Post('validate')
  async validate(@Body() body: ValidateDefinitionDto) {
    const hasRef = Boolean(body.definitionRef);
    const hasDefinition = Boolean(body.definition);
    if ((hasRef && hasDefinition) || (!hasRef && !hasDefinition)) {
      throw new BadRequestException(
        'either definitionRef or definition must be provided',
      );
    }

    return this.validateDefinitionUseCase.execute({
      definitionRef: body.definitionRef,
      definition: body.definition
        ? {
            contentType: body.definition.contentType,
            content: body.definition.content,
            outputSchema: body.definition.outputSchema ?? null,
            runnerConfig: body.definition.runnerConfig ?? null,
          }
        : undefined,
    });
  }

  @Post('dry-run')
  async dryRun(@Body() body: DryRunDto) {
    const hasRef = Boolean(body.definitionRef);
    const hasDefinition = Boolean(body.definition);
    if ((hasRef && hasDefinition) || (!hasRef && !hasDefinition)) {
      throw new BadRequestException(
        'either definitionRef or definition must be provided',
      );
    }

    try {
      return await this.dryRunUseCase.execute({
        definitionRef: body.definitionRef,
        definition: body.definition
          ? {
              contentType: body.definition.contentType,
              content: body.definition.content,
              outputSchema: body.definition.outputSchema ?? null,
              runnerConfig: body.definition.runnerConfig ?? null,
            }
          : undefined,
        inputs: body.inputs,
        entrypointKey: body.entrypointKey,
        options: body.options ?? {},
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Post(':definitionId/publish')
  async publish(
    @Param('definitionId') definitionId: string,
    @Body() body: PublishDefinitionDto,
  ) {
    try {
      return await this.publishDefinitionUseCase.execute({
        definitionId,
        draftRevisionId: body.draftRevisionId,
        changelog: body.changelog,
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Post(':definitionId/releases/:definitionHash/deprecate')
  async deprecate(
    @Param('definitionId') definitionId: string,
    @Param('definitionHash') definitionHash: string,
    @Body() body: DeprecateReleaseDto,
  ) {
    try {
      return await this.deprecateReleaseUseCase.execute({
        definitionId,
        definitionHash,
        reason: body.reason,
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Get(':definitionId/releases')
  async listReleases(@Param('definitionId') definitionId: string) {
    return this.listReleasesUseCase.execute(definitionId);
  }

  @Get(':definitionId/releases/:definitionHash')
  async getRelease(
    @Param('definitionId') definitionId: string,
    @Param('definitionHash') definitionHash: string,
  ) {
    try {
      return await this.getReleaseUseCase.execute(definitionId, definitionHash);
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }
}

function mapUseCaseError(error: unknown) {
  if (!(error instanceof UseCaseError)) {
    return error;
  }

  switch (error.code) {
    case 'DEFINITION_DRAFT_NOT_FOUND':
    case 'DEFINITION_NOT_FOUND':
    case 'DEFINITION_DEPENDENCY_NOT_FOUND':
      return new NotFoundException({
        code: error.code,
        message: error.message,
      });
    case 'DRAFT_REVISION_CONFLICT':
      return new ConflictException({
        code: error.code,
        message: error.message,
      });
    case 'DEFINITION_INVALID':
    case 'INPUT_VALIDATION_ERROR':
    case 'INVALID_MESSAGE':
    case 'RUNNER_DETERMINISTIC_ERROR':
      return new BadRequestException({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    case 'RUNNER_TIMEOUT':
      return new BadRequestException({
        code: error.code,
        message: error.message,
      });
    case 'DEFINITION_NOT_PUBLISHED':
    case 'DEFINITION_DEPENDENCY_NOT_PUBLISHED':
      return new ConflictException({
        code: error.code,
        message: error.message,
      });
    default:
      return new BadRequestException({
        code: error.code,
        message: error.message,
        details: error.details,
      });
  }
}

function encodeDefinitionCursor(cursor: DefinitionListCursor): string {
  const payload = {
    updatedAt: cursor.updatedAt.toISOString(),
    definitionId: cursor.definitionId,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeDefinitionCursor(value: string): DefinitionListCursor {
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error('cursor is not an object');
    }
    const updatedAt =
      typeof parsed['updatedAt'] === 'string'
        ? new Date(parsed['updatedAt'])
        : null;
    const definitionId =
      typeof parsed['definitionId'] === 'string'
        ? parsed['definitionId']
        : null;

    if (!updatedAt || Number.isNaN(updatedAt.getTime()) || !definitionId) {
      throw new Error('cursor fields invalid');
    }

    return { updatedAt, definitionId };
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'invalid cursor',
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
