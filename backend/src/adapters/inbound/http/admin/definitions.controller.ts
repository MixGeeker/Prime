import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateDraftUseCase } from '../../../../application/use-cases/create-draft.use-case';
import { DeleteDraftUseCase } from '../../../../application/use-cases/delete-draft.use-case';
import { DeprecateVersionUseCase } from '../../../../application/use-cases/deprecate-version.use-case';
import { DryRunUseCase } from '../../../../application/use-cases/dry-run.use-case';
import { GetDraftUseCase } from '../../../../application/use-cases/get-draft.use-case';
import { GetVersionUseCase } from '../../../../application/use-cases/get-version.use-case';
import { ListVersionsUseCase } from '../../../../application/use-cases/list-versions.use-case';
import { PublishDefinitionUseCase } from '../../../../application/use-cases/publish-definition.use-case';
import { UpdateDraftUseCase } from '../../../../application/use-cases/update-draft.use-case';
import { UseCaseError } from '../../../../application/use-cases/use-case.error';
import { ValidateDefinitionUseCase } from '../../../../application/use-cases/validate-definition.use-case';
import {
  CreateDefinitionDraftDto,
  DeprecateVersionDto,
  DryRunDto,
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
    private readonly deprecateVersionUseCase: DeprecateVersionUseCase,
    private readonly listVersionsUseCase: ListVersionsUseCase,
    private readonly getVersionUseCase: GetVersionUseCase,
  ) {}

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

  @Post(':definitionId/versions/:version/deprecate')
  async deprecate(
    @Param('definitionId') definitionId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: DeprecateVersionDto,
  ) {
    try {
      return await this.deprecateVersionUseCase.execute({
        definitionId,
        version,
        reason: body.reason,
      });
    } catch (error) {
      throw mapUseCaseError(error);
    }
  }

  @Get(':definitionId/versions')
  async listVersions(@Param('definitionId') definitionId: string) {
    return this.listVersionsUseCase.execute(definitionId);
  }

  @Get(':definitionId/versions/:version')
  async getVersion(
    @Param('definitionId') definitionId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    try {
      return await this.getVersionUseCase.execute(definitionId, version);
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
