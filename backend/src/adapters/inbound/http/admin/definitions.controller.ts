import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ValidateDefinitionUseCase } from '../../../../application/use-cases/validate-definition.use-case';
import {
  CreateDefinitionDraftDto,
  DeprecateVersionDto,
  DryRunDto,
  PublishDefinitionDto,
  UpdateDefinitionDraftDto,
  ValidateDefinitionDto,
} from './dto/definitions.dto';

/**
 * Definitions Admin API（占位）。
 *
 * 参考：
 * - `compute-engine/API_DESIGN.md`（HTTP Admin API 契约）
 * - M4 里程碑会接入 application/use-cases 形成闭环。
 */
@Controller('/admin/definitions')
@ApiTags('admin')
export class AdminDefinitionsController {
  constructor(
    private readonly validateDefinitionUseCase: ValidateDefinitionUseCase,
  ) {}

  @Post()
  createDraft(@Body() _body: CreateDefinitionDraftDto) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Get(':definitionId/draft')
  getDraft(@Param('definitionId') _definitionId: string) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Put(':definitionId/draft')
  updateDraft(
    @Param('definitionId') _definitionId: string,
    @Body() _body: UpdateDefinitionDraftDto,
  ) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Delete(':definitionId/draft')
  deleteDraft(@Param('definitionId') _definitionId: string) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Post('validate')
  validate(@Body() body: ValidateDefinitionDto) {
    // M2 先支持“一次性 definition 校验”（编辑器实时提示/本地校验）。
    // M4 再支持 definitionRef（读 DB 的已发布版本或 draft）。
    if (!body.definition) {
      throw new BadRequestException(
        'M2 only supports validating inline `definition` (definitionRef supported in M4)',
      );
    }
    return this.validateDefinitionUseCase.execute({
      contentType: body.definition.contentType,
      content: body.definition.content,
      outputSchema: body.definition.outputSchema ?? null,
      runnerConfig: body.definition.runnerConfig ?? null,
    });
  }

  @Post('dry-run')
  dryRun(@Body() _body: DryRunDto) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Post(':definitionId/publish')
  publish(
    @Param('definitionId') _definitionId: string,
    @Body() _body: PublishDefinitionDto,
  ) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Post(':definitionId/versions/:version/deprecate')
  deprecate(
    @Param('definitionId') _definitionId: string,
    @Param('version', ParseIntPipe) _version: number,
    @Body() _body: DeprecateVersionDto,
  ) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Get(':definitionId/versions')
  listVersions(@Param('definitionId') _definitionId: string) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }

  @Get(':definitionId/versions/:version')
  getVersion(
    @Param('definitionId') _definitionId: string,
    @Param('version', ParseIntPipe) _version: number,
  ) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }
}
