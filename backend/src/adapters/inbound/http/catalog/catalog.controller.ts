import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NodeCatalogService } from '../../../../application/catalog/node-catalog.service';

/**
 * Node Catalog controller（M2）。
 *
 * 参考 `compute-engine/API_DESIGN.md` 4. Node Catalog。
 */
@Controller('/catalog')
@ApiTags('catalog')
export class CatalogController {
  constructor(private readonly nodeCatalogService: NodeCatalogService) {}

  @Get('/nodes')
  getNodes() {
    return this.nodeCatalogService.getCatalog();
  }
}
