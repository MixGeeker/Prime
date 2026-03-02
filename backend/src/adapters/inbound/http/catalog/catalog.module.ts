import { Module } from '@nestjs/common';
import { ApplicationModule } from '../../../../application/application.module';
import { CatalogController } from './catalog.controller';

/**
 * Node Catalog 模块（HTTP inbound）。
 *
 * M2 会实现 `GET /catalog/nodes`，用于 Editor 拉取白名单节点与端口/类型信息。
 */
@Module({
  imports: [ApplicationModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
