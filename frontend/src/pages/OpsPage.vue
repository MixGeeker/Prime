<template>
  <el-card class="card">
    <template #header>
      <div class="hdr">
        <div>Ops（仪表盘）</div>
        <div class="row">
          <el-button :loading="loadingAll" @click="refreshAll">刷新全部</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="tab">
      <el-tab-pane label="总览" name="overview">
        <div class="grid">
          <el-card class="stat">
            <template #header>Outbox</template>
            <div class="kv">
              <div class="k">pending</div>
              <div class="v">{{ opsStats?.outbox?.pending ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">failed</div>
              <div class="v">{{ opsStats?.outbox?.failed ?? '-' }}</div>
            </div>
            <div class="muted">failed 仅统计 attempts &lt; maxAttempts 的记录。</div>
          </el-card>

          <el-card class="stat">
            <template #header>Jobs（窗口内）</template>
            <div class="kv">
              <div class="k">requested</div>
              <div class="v">{{ opsStats?.jobs?.requested ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">running</div>
              <div class="v">{{ opsStats?.jobs?.running ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">succeeded</div>
              <div class="v">{{ opsStats?.jobs?.succeeded ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">failed</div>
              <div class="v">{{ opsStats?.jobs?.failed ?? '-' }}</div>
            </div>
            <div class="muted">窗口：最近 {{ opsStats?.window?.jobsSinceHours ?? 24 }} 小时</div>
          </el-card>

          <el-card class="stat">
            <template #header>DLQ（危险）</template>
            <div class="kv">
              <div class="k">queue</div>
              <div class="v mono">{{ dlqStats?.dlqQueue ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">messageCount</div>
              <div class="v">{{ dlqStats?.messageCount ?? '-' }}</div>
            </div>
            <div class="kv">
              <div class="k">consumerCount</div>
              <div class="v">{{ dlqStats?.consumerCount ?? '-' }}</div>
            </div>
            <div class="row" style="margin-top: 10px">
              <el-button :loading="dlqLoading" @click="refreshDlq">刷新</el-button>
              <el-button type="warning" :disabled="!dlqStats" @click="openDlqReplay">replay</el-button>
            </div>
            <div class="muted">需要启用危险端点并配置 Admin Token。</div>
          </el-card>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Definitions" name="definitions">
        <div class="row" style="margin-bottom: 10px">
          <el-input v-model="defsQuery" placeholder="搜索 definitionId..." clearable style="max-width: 420px" />
          <el-button :loading="defsLoading" @click="refreshDefinitions">搜索/刷新</el-button>
        </div>

        <el-table :data="definitions" size="small" height="520px" stripe>
          <el-table-column prop="definitionId" label="definitionId" min-width="220" />
          <el-table-column label="latest" min-width="220">
            <template #default="{ row }">
              <span class="mono muted">{{ row.latestDefinitionHash ? row.latestDefinitionHash.slice(0, 12) + '…' : '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="latestStatus" label="status" width="110" />
          <el-table-column label="draft" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.draftRevisionId" type="warning">draft</el-tag>
              <el-tag v-else type="info">-</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="updatedAt" min-width="200">
            <template #default="{ row }">
              <span class="muted">{{ row.updatedAt }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button text @click="openInStudio(row.definitionId)">Studio</el-button>
              <el-button text @click="openReleases(row.definitionId)">Releases</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="row" style="margin-top: 10px">
          <el-button :disabled="!defsNextCursor" :loading="defsLoadingMore" @click="loadMoreDefinitions">
            加载更多
          </el-button>
          <span v-if="!defsNextCursor" class="muted">已到底</span>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Jobs" name="jobs">
        <div class="row" style="margin-bottom: 10px; flex-wrap: wrap">
          <el-select v-model="jobsStatus" clearable placeholder="status" style="width: 160px">
            <el-option value="requested" label="requested" />
            <el-option value="running" label="running" />
            <el-option value="succeeded" label="succeeded" />
            <el-option value="failed" label="failed" />
          </el-select>
          <el-input v-model="jobsDefinitionId" placeholder="definitionId（可选）" clearable style="max-width: 260px" />
          <el-button :loading="jobsLoading" @click="refreshJobs">刷新</el-button>
        </div>

        <el-table :data="jobs" size="small" height="520px" stripe @row-click="openJob">
          <el-table-column prop="jobId" label="jobId" min-width="220" />
          <el-table-column prop="definitionId" label="definitionId" min-width="200" />
          <el-table-column prop="status" label="status" width="110" />
          <el-table-column prop="requestedAt" label="requestedAt" min-width="200" />
          <el-table-column label="error" min-width="220">
            <template #default="{ row }">
              <span class="muted">{{ row.errorCode ? `${row.errorCode}: ${row.errorMessage}` : '-' }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="row" style="margin-top: 10px">
          <el-button :disabled="!jobsNextCursor" :loading="jobsLoadingMore" @click="loadMoreJobs">
            加载更多
          </el-button>
          <span v-if="!jobsNextCursor" class="muted">已到底</span>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Provider" name="provider">
        <el-alert
          title="Provider Simulator（示例）"
          type="info"
          show-icon
          description="用于演示：全局 facts + 业务 inputs 组装 + MQ 投递 + 订阅结果事件。Base URL 在 设置 页面配置。"
          style="margin-bottom: 12px"
        />

        <el-card class="stat" style="margin-bottom: 12px">
          <template #header>
            <div class="hdr">
              <div>健康检查</div>
              <el-button :loading="providerLoading" @click="refreshProvider">刷新</el-button>
            </div>
          </template>
          <pre v-if="providerHealth" class="mono box">{{ JSON.stringify(providerHealth, null, 2) }}</pre>
          <div v-else class="muted">暂无数据。</div>
        </el-card>

        <el-card class="stat" style="margin-bottom: 12px">
          <template #header>
            <div class="hdr">
              <div>全局 facts（inputs.globals）</div>
              <div class="row">
                <el-button :loading="factsLoading" @click="loadFacts">加载</el-button>
                <el-button type="primary" :loading="factsSaving" @click="saveFacts">保存</el-button>
              </div>
            </div>
          </template>
          <el-input
            v-model="factsText"
            type="textarea"
            :autosize="{ minRows: 10, maxRows: 18 }"
            placeholder="{ }"
            class="mono"
          />
          <div v-if="factsError" class="muted" style="color: var(--el-color-danger); margin-top: 6px">
            {{ factsError }}
          </div>
        </el-card>

        <el-card class="stat" style="margin-bottom: 12px">
          <template #header>触发一次 Job（投递 MQ）</template>
          <el-form label-position="top" :model="providerJobForm">
            <el-form-item label="definitionId">
              <el-select
                v-model="providerJobForm.definitionId"
                filterable
                remote
                clearable
                placeholder="搜索 definitionId..."
                :remote-method="searchProviderDefinitions"
                :loading="providerDefinitionLoading"
                style="width: 100%"
                @change="onProviderDefinitionChange"
              >
                <el-option
                  v-for="d in providerDefinitionOptions"
                  :key="d.definitionId"
                  :value="d.definitionId"
                  :label="d.definitionId"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="definitionHash">
              <el-select
                v-model="providerJobForm.definitionHash"
                clearable
                placeholder="选择版本 hash"
                :loading="providerReleasesLoading"
                style="width: 100%"
                @change="onProviderHashChange"
              >
                <el-option
                  v-for="r in providerReleaseOptions"
                  :key="r.definitionHash"
                  :value="r.definitionHash"
                  :label="formatProviderReleaseLabel(r)"
                  :disabled="r.status !== 'published'"
                />
              </el-select>
              <div
                v-if="providerHashHint"
                class="muted"
                :style="{ marginTop: '6px', color: providerHashHintType === 'error' ? 'var(--el-color-danger)' : undefined }"
              >
                {{ providerHashHint }}
              </div>
            </el-form-item>
            <el-form-item label="inputs（JSON）">
              <el-input v-model="providerJobForm.paramsJson" type="textarea" :autosize="{ minRows: 6, maxRows: 12 }" class="mono" />
              <div v-if="providerJobForm.paramsError" class="muted" style="color: var(--el-color-danger); margin-top: 6px">
                {{ providerJobForm.paramsError }}
              </div>
            </el-form-item>
            <el-form-item label="options（JSON，可选）">
              <el-input v-model="providerJobForm.optionsJson" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" class="mono" />
              <div v-if="providerJobForm.optionsError" class="muted" style="color: var(--el-color-danger); margin-top: 6px">
                {{ providerJobForm.optionsError }}
              </div>
            </el-form-item>

            <div class="row">
              <el-switch v-model="providerJobForm.mergeGlobalFacts" active-text="合并全局 facts" inactive-text="不合并" />
              <el-button :loading="providerTriggerLoading" :disabled="!canTriggerProviderJob" type="primary" @click="triggerProviderJob">
                触发
              </el-button>
              <el-button @click="fillTaxDiscountExample">填充 tax-discount 示例</el-button>
            </div>
          </el-form>
        </el-card>

        <el-card class="stat" style="margin-bottom: 12px">
          <template #header>压测（批量触发 Job）</template>
          <el-form label-position="top">
            <div style="display: flex; gap: 16px; margin-bottom: 12px">
              <el-form-item label="发送总数" style="flex: 1; margin-bottom: 0">
                <el-input-number
                  v-model="stressTest.total"
                  :min="1"
                  :max="5000"
                  :disabled="stressTest.running"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="并发数" style="flex: 1; margin-bottom: 0">
                <el-input-number
                  v-model="stressTest.concurrency"
                  :min="1"
                  :max="100"
                  :disabled="stressTest.running"
                  style="width: 100%"
                />
              </el-form-item>
            </div>

            <div v-if="stressTest.running || stressTestCompleted > 0" style="margin-bottom: 12px">
              <el-progress
                :percentage="stressTestProgress"
                :status="stressTest.running ? undefined : stressTest.failed > 0 ? 'exception' : 'success'"
              />
              <div style="display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; font-size: 13px">
                <span class="muted">已完成 {{ stressTestCompleted }} / {{ stressTest.total }}</span>
                <span style="color: var(--el-color-success)">成功 {{ stressTest.success }}</span>
                <span style="color: var(--el-color-danger)">失败 {{ stressTest.failed }}</span>
                <span class="muted">耗时 {{ (stressTest.elapsedMs / 1000).toFixed(2) }}s</span>
                <span v-if="!stressTest.running && stressTestCompleted > 0 && stressTest.elapsedMs > 0" class="muted">
                  吞吐 {{ (stressTestCompleted / (stressTest.elapsedMs / 1000)).toFixed(1) }} req/s
                </span>
              </div>
            </div>

            <div class="row">
              <el-button
                v-if="!stressTest.running"
                type="warning"
                :disabled="!canTriggerProviderJob"
                @click="runStressTest"
              >
                开始压测
              </el-button>
              <el-button v-else type="danger" @click="stressTest.aborted = true">中止</el-button>
              <span class="muted" style="font-size: 12px">复用上方表单的 definitionId / hash / inputs / options</span>
            </div>
          </el-form>
        </el-card>

        <el-card class="stat">
          <template #header>
            <div class="hdr">
              <div>Provider Job 视图（本服务落地）</div>
              <el-button :loading="providerJobsLoading" @click="loadProviderJobs">刷新</el-button>
            </div>
          </template>
          <el-table :data="providerJobs" size="small" height="360px" stripe @row-click="openProviderJob">
            <el-table-column prop="jobId" label="jobId" min-width="240" />
            <el-table-column prop="status" label="status" width="120" />
            <el-table-column prop="requestedAt" label="requestedAt" min-width="200" />
            <el-table-column label="lastEvent" min-width="220">
              <template #default="{ row }">
                <span class="muted">{{ row.lastEvent?.routingKey ?? '-' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="DLQ" name="dlq">
        <el-alert
          title="DLQ 属于危险运维能力"
          type="warning"
          show-icon
          description="需要在后端启用 ADMIN_DANGEROUS_ENDPOINTS_ENABLED 并配置 ADMIN_API_TOKEN；UI 会在请求时带 Authorization: Bearer <token>。"
          style="margin-bottom: 12px"
        />

        <div class="row" style="margin-bottom: 10px">
          <el-button :loading="dlqLoading" @click="refreshDlq">刷新 stats</el-button>
          <el-button type="warning" :disabled="!dlqStats" @click="openDlqReplay">replay</el-button>
          <span v-if="dlqError" class="muted">{{ dlqError }}</span>
        </div>

        <pre v-if="dlqStats" class="mono box">{{ JSON.stringify(dlqStats, null, 2) }}</pre>
        <div v-else class="muted">暂无数据。</div>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-drawer v-model="releasesOpen" title="Releases" size="50%">
    <div class="row" style="margin-bottom: 10px">
      <div class="muted">definitionId: {{ releasesDefinitionId }}</div>
      <el-button :loading="releasesLoading" @click="refreshReleases">刷新</el-button>
    </div>
    <el-table :data="releases" size="small" height="520px" stripe>
      <el-table-column prop="definitionHash" label="definitionHash" min-width="260" />
      <el-table-column prop="status" label="status" width="120" />
      <el-table-column prop="publishedAt" label="publishedAt" min-width="200" />
      <el-table-column prop="deprecatedAt" label="deprecatedAt" min-width="200" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button text @click="copy(row.definitionHash)">复制 hash</el-button>
          <el-button v-if="row.status === 'published'" text type="danger" @click="deprecate(row.definitionHash)">
            deprecate
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>

  <el-drawer v-model="jobOpen" title="Job Detail" size="55%">
    <div class="row" style="margin-bottom: 10px">
      <div class="muted">jobId: {{ jobId }}</div>
      <el-button :loading="jobLoading" @click="refreshJob">刷新</el-button>
    </div>
    <pre v-if="jobDetail" class="mono box">{{ JSON.stringify(jobDetail, null, 2) }}</pre>
    <div v-else class="muted">暂无数据。</div>
  </el-drawer>

  <el-drawer v-model="providerJobOpen" title="Provider Job Detail" size="55%">
    <div class="row" style="margin-bottom: 10px">
      <div class="muted">jobId: {{ providerJobId }}</div>
      <el-button :loading="providerJobLoading" @click="refreshProviderJob">刷新</el-button>
    </div>
    <pre v-if="providerJobDetail" class="mono box">{{ JSON.stringify(providerJobDetail, null, 2) }}</pre>
    <div v-else class="muted">暂无数据。</div>
  </el-drawer>

  <el-dialog v-model="dlqReplayOpen" title="DLQ Replay（危险）" width="520px">
    <el-form label-position="top" :model="dlqReplayForm">
      <el-form-item label="limit（最大回放条数）">
        <el-input-number v-model="dlqReplayForm.limit" :min="1" :max="200" />
      </el-form-item>
      <el-form-item label="dryRun（演练，不真正 publish）">
        <el-switch v-model="dlqReplayForm.dryRun" />
      </el-form-item>
      <el-form-item label="minIntervalMs（每条间隔）">
        <el-input-number v-model="dlqReplayForm.minIntervalMs" :min="0" :max="10000" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlqReplayOpen = false">取消</el-button>
      <el-button type="warning" :loading="dlqReplayLoading" @click="doDlqReplay">执行</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { backendApi, normalizeHttpError } from '@/api/backend';
import { providerSimulatorApi } from '@/api/provider-simulator';
import type { DefinitionSummary } from '@/engine/types';
import { useSettingsStore } from '@/stores/settings';

const router = useRouter();
const settings = useSettingsStore();

const tab = ref<'overview' | 'definitions' | 'jobs' | 'provider' | 'dlq'>('overview');

const opsLoading = ref(false);
const opsStats = ref<any | null>(null);

const dlqLoading = ref(false);
const dlqStats = ref<any | null>(null);
const dlqError = ref<string | null>(null);

const defsLoading = ref(false);
const defsLoadingMore = ref(false);
const defsQuery = ref('');
const definitions = ref<DefinitionSummary[]>([]);
const defsNextCursor = ref<string | null>(null);

const jobsLoading = ref(false);
const jobsLoadingMore = ref(false);
const jobsStatus = ref<string | null>(null);
const jobsDefinitionId = ref('');
const jobs = ref<any[]>([]);
const jobsNextCursor = ref<string | null>(null);

// Provider Simulator
const providerLoading = ref(false);
const providerHealth = ref<any | null>(null);

const factsLoading = ref(false);
const factsSaving = ref(false);
const factsText = ref('{}');
const factsError = ref<string | null>(null);

type ProviderReleaseOption = {
  definitionHash: string;
  status: 'published' | 'deprecated';
  publishedAt: string;
};

const providerDefinitionLoading = ref(false);
const providerDefinitionOptions = ref<DefinitionSummary[]>([]);
const providerReleasesLoading = ref(false);
const providerReleaseOptions = ref<ProviderReleaseOption[]>([]);
const providerHashHint = ref<string | null>('请选择 definitionId 以加载可用版本');
const providerHashHintType = ref<'info' | 'warning' | 'error'>('info');

const providerTriggerLoading = ref(false);
const providerJobForm = reactive({
  definitionId: 'example.tax-discount',
  definitionHash: '',
  paramsJson: JSON.stringify({ basePrice: '100.00', taxRate: '0.13', discountRate: '0.10' }, null, 2),
  optionsJson: '{}',
  mergeGlobalFacts: true,
  paramsError: '' as string | null,
  optionsError: '' as string | null,
});

const providerJobsLoading = ref(false);
const providerJobs = ref<any[]>([]);

const providerJobOpen = ref(false);
const providerJobLoading = ref(false);
const providerJobId = ref('');
const providerJobDetail = ref<any | null>(null);

const releasesOpen = ref(false);
const releasesLoading = ref(false);
const releasesDefinitionId = ref('');
const releases = ref<any[]>([]);

const jobOpen = ref(false);
const jobLoading = ref(false);
const jobId = ref('');
const jobDetail = ref<any | null>(null);

const dlqReplayOpen = ref(false);
const dlqReplayLoading = ref(false);
const dlqReplayForm = reactive({
  limit: 50,
  dryRun: true,
  minIntervalMs: 0,
});

const loadingAll = computed(() => opsLoading.value || defsLoading.value || jobsLoading.value || dlqLoading.value);
const canTriggerProviderJob = computed(
  () => Boolean(trimmedString(providerJobForm.definitionId) && trimmedString(providerJobForm.definitionHash)),
);

const stressTest = reactive({
  total: 100,
  concurrency: 10,
  running: false,
  success: 0,
  failed: 0,
  elapsedMs: 0,
  aborted: false,
});
const stressTestCompleted = computed(() => stressTest.success + stressTest.failed);
const stressTestProgress = computed(() => {
  if (stressTest.total === 0) return 0;
  return Math.min(100, Math.round((stressTestCompleted.value / stressTest.total) * 100));
});

function parseJsonObject(text: string, field: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: `${field} 必须是 object` };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `${field} JSON 解析失败：${String(e)}` };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function setProviderHashHint(
  message: string | null,
  type: 'info' | 'warning' | 'error' = 'info',
) {
  providerHashHint.value = message;
  providerHashHintType.value = type;
}

function formatProviderReleaseLabel(release: ProviderReleaseOption): string {
  const hashLabel =
    release.definitionHash.length > 12
      ? `${release.definitionHash.slice(0, 12)}…`
      : release.definitionHash;
  const dateLabel = release.publishedAt.slice(0, 10);
  return `${hashLabel} (${dateLabel}) [${release.status}]`;
}

function buildProviderInputsTemplate(pins: unknown): Record<string, unknown> {
  if (!Array.isArray(pins)) return {};
  const template: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const pin of pins) {
    if (!isPlainObject(pin)) continue;
    const name = typeof pin.name === 'string' ? pin.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    switch (pin.valueType) {
      case 'Decimal':
      case 'Ratio':
        template[name] = '0';
        break;
      case 'String':
        template[name] = '';
        break;
      case 'Boolean':
        template[name] = false;
        break;
      case 'DateTime':
        template[name] = new Date().toISOString();
        break;
      case 'Json':
        template[name] = null;
        break;
      default:
        template[name] = null;
        break;
    }
  }
  return template;
}

async function searchProviderDefinitions(q: string) {
  providerDefinitionLoading.value = true;
  try {
    const res = await backendApi.listDefinitions({ q, limit: 50 });
    providerDefinitionOptions.value = res.items;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerDefinitionLoading.value = false;
  }
}

async function generateProviderInputsFromRelease(definitionId: string, definitionHash: string) {
  const release = await backendApi.getRelease(definitionId, definitionHash);
  const contentRaw = isPlainObject(release) ? release.content : null;
  if (!isPlainObject(contentRaw)) return;
  const nodes = Array.isArray(contentRaw.nodes) ? contentRaw.nodes : [];
  const startNode = nodes.find((n) => isPlainObject(n) && n.nodeType === 'flow.start');
  if (!isPlainObject(startNode)) return;
  const params = isPlainObject(startNode.params) ? startNode.params : {};
  const template = buildProviderInputsTemplate(params.dynamicOutputs);
  providerJobForm.paramsJson = JSON.stringify(template, null, 2);
  providerJobForm.paramsError = null;
}

async function onProviderDefinitionChange() {
  providerJobForm.definitionHash = '';
  providerReleaseOptions.value = [];
  providerJobForm.paramsJson = '{}';
  providerJobForm.paramsError = null;

  const definitionId = trimmedString(providerJobForm.definitionId);
  if (!definitionId) {
    setProviderHashHint('请选择 definitionId 以加载可用版本', 'info');
    return;
  }

  providerReleasesLoading.value = true;
  setProviderHashHint('正在加载可用版本...', 'info');
  try {
    const releases = await backendApi.listReleases(definitionId);
    providerReleaseOptions.value = releases.map((it) => ({
      definitionHash: it.definitionHash,
      status: it.status,
      publishedAt: it.publishedAt,
    }));

    if (providerReleaseOptions.value.length === 0) {
      setProviderHashHint('该 definition 暂无 release，请先发布。', 'warning');
      return;
    }

    const latestPublished = providerReleaseOptions.value.find((r) => r.status === 'published') ?? null;
    if (!latestPublished) {
      setProviderHashHint('该 definition 暂无可用的 published 版本。', 'warning');
      return;
    }

    providerJobForm.definitionHash = latestPublished.definitionHash;
    await generateProviderInputsFromRelease(definitionId, latestPublished.definitionHash);
    setProviderHashHint(null);
  } catch (e) {
    setProviderHashHint(`加载版本失败：${normalizeHttpError(e)}`, 'error');
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerReleasesLoading.value = false;
  }
}

async function onProviderHashChange() {
  const definitionId = trimmedString(providerJobForm.definitionId);
  const definitionHash = trimmedString(providerJobForm.definitionHash);
  if (!definitionId || !definitionHash) {
    setProviderHashHint('请选择一个 published 版本后再触发。', 'info');
    return;
  }
  try {
    await generateProviderInputsFromRelease(definitionId, definitionHash);
    setProviderHashHint(null);
  } catch (e) {
    setProviderHashHint(`加载版本内容失败：${normalizeHttpError(e)}`, 'error');
    ElMessage.error(normalizeHttpError(e));
  }
}

async function refreshOps() {
  opsLoading.value = true;
  try {
    opsStats.value = await backendApi.getOpsStats({ jobsSinceHours: 24 });
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    opsLoading.value = false;
  }
}

async function refreshDlq() {
  if (!settings.adminToken.trim()) {
    dlqStats.value = null;
    dlqError.value = '未配置 Admin Token（见 设置 页面）';
    return;
  }
  dlqLoading.value = true;
  dlqError.value = null;
  try {
    dlqStats.value = await backendApi.dlqStats();
  } catch (e) {
    dlqStats.value = null;
    dlqError.value = normalizeHttpError(e);
    ElMessage.error(dlqError.value);
  } finally {
    dlqLoading.value = false;
  }
}

async function refreshDefinitions() {
  defsLoading.value = true;
  try {
    const res = await backendApi.listDefinitions({ q: defsQuery.value.trim(), limit: 50 });
    definitions.value = res.items;
    defsNextCursor.value = res.nextCursor;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    defsLoading.value = false;
  }
}

async function loadMoreDefinitions() {
  if (!defsNextCursor.value) return;
  defsLoadingMore.value = true;
  try {
    const res = await backendApi.listDefinitions({
      q: defsQuery.value.trim(),
      limit: 50,
      cursor: defsNextCursor.value,
    });
    definitions.value = [...definitions.value, ...res.items];
    defsNextCursor.value = res.nextCursor;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    defsLoadingMore.value = false;
  }
}

async function refreshJobs() {
  jobsLoading.value = true;
  try {
    const res = await backendApi.listJobs({
      limit: 50,
      status: (jobsStatus.value as any) ?? undefined,
      definitionId: jobsDefinitionId.value.trim() || undefined,
    });
    jobs.value = res.items;
    jobsNextCursor.value = res.nextCursor;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    jobsLoading.value = false;
  }
}

async function loadMoreJobs() {
  if (!jobsNextCursor.value) return;
  jobsLoadingMore.value = true;
  try {
    const res = await backendApi.listJobs({
      limit: 50,
      cursor: jobsNextCursor.value,
      status: (jobsStatus.value as any) ?? undefined,
      definitionId: jobsDefinitionId.value.trim() || undefined,
    });
    jobs.value = [...jobs.value, ...res.items];
    jobsNextCursor.value = res.nextCursor;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    jobsLoadingMore.value = false;
  }
}

function openInStudio(definitionId: string) {
  void router.push({ path: '/studio', query: { definitionId } });
}

async function openReleases(definitionId: string) {
  releasesDefinitionId.value = definitionId;
  releasesOpen.value = true;
  await refreshReleases();
}

async function refreshReleases() {
  if (!releasesDefinitionId.value) return;
  releasesLoading.value = true;
  try {
    releases.value = await backendApi.listReleases(releasesDefinitionId.value);
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    releasesLoading.value = false;
  }
}

async function deprecate(definitionHash: string) {
  if (!releasesDefinitionId.value) return;
  try {
    await backendApi.deprecateRelease(releasesDefinitionId.value, definitionHash, { reason: 'deprecated by ops' });
    ElMessage.success('已 deprecated');
    await refreshReleases();
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  }
}

function copy(text: string) {
  void navigator.clipboard.writeText(text);
  ElMessage.success('已复制');
}

function openJob(row: any) {
  jobId.value = row.jobId;
  jobOpen.value = true;
  void refreshJob();
}

async function refreshJob() {
  if (!jobId.value) return;
  jobLoading.value = true;
  try {
    jobDetail.value = await backendApi.getJob(jobId.value);
  } catch (e) {
    jobDetail.value = null;
    ElMessage.error(normalizeHttpError(e));
  } finally {
    jobLoading.value = false;
  }
}

async function refreshProvider() {
  providerLoading.value = true;
  try {
    providerHealth.value = await providerSimulatorApi.health();
  } catch (e) {
    providerHealth.value = null;
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerLoading.value = false;
  }
}

async function loadFacts() {
  factsLoading.value = true;
  factsError.value = null;
  try {
    const facts = await providerSimulatorApi.getGlobalFacts();
    factsText.value = JSON.stringify(facts ?? {}, null, 2);
    ElMessage.success('已加载');
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    factsLoading.value = false;
  }
}

async function saveFacts() {
  const parsed = parseJsonObject(factsText.value, 'facts');
  factsError.value = parsed.ok ? null : parsed.error;
  if (!parsed.ok) return;

  factsSaving.value = true;
  try {
    await providerSimulatorApi.setGlobalFacts(parsed.value);
    ElMessage.success('已保存');
    await refreshProvider();
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    factsSaving.value = false;
  }
}

async function fillTaxDiscountExample() {
  providerJobForm.definitionId = 'example.tax-discount';
  providerJobForm.optionsJson = '{}';
  providerJobForm.mergeGlobalFacts = true;
  providerJobForm.paramsError = null;
  providerJobForm.optionsError = null;
  await searchProviderDefinitions('example.tax-discount');
  await onProviderDefinitionChange();
}

async function triggerProviderJob() {
  providerJobForm.paramsError = null;
  providerJobForm.optionsError = null;

  const definitionId = trimmedString(providerJobForm.definitionId);
  const definitionHash = trimmedString(providerJobForm.definitionHash);
  if (!definitionId || !definitionHash) {
    ElMessage.warning('definitionId / definitionHash 不能为空');
    return;
  }

  const paramsParsed = parseJsonObject(providerJobForm.paramsJson, 'inputs');
  if (!paramsParsed.ok) {
    providerJobForm.paramsError = paramsParsed.error;
    return;
  }

  const optionsParsed = parseJsonObject(providerJobForm.optionsJson, 'options');
  if (!optionsParsed.ok) {
    providerJobForm.optionsError = optionsParsed.error;
    return;
  }

  providerTriggerLoading.value = true;
  try {
    const res = await providerSimulatorApi.triggerJob({
      definitionRef: { definitionId, definitionHash },
      inputs: paramsParsed.value,
      options: optionsParsed.value,
      mergeGlobalFacts: providerJobForm.mergeGlobalFacts,
    });
    ElMessage.success(`已触发：${res.jobId}`);
    await Promise.all([loadProviderJobs(), refreshJobs()]);
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerTriggerLoading.value = false;
  }
}

async function runStressTest() {
  providerJobForm.paramsError = null;
  providerJobForm.optionsError = null;

  const definitionId = trimmedString(providerJobForm.definitionId);
  const definitionHash = trimmedString(providerJobForm.definitionHash);
  if (!definitionId || !definitionHash) {
    ElMessage.warning('请先填写 definitionId / definitionHash');
    return;
  }

  const paramsParsed = parseJsonObject(providerJobForm.paramsJson, 'inputs');
  if (!paramsParsed.ok) {
    providerJobForm.paramsError = paramsParsed.error;
    return;
  }
  const optionsParsed = parseJsonObject(providerJobForm.optionsJson, 'options');
  if (!optionsParsed.ok) {
    providerJobForm.optionsError = optionsParsed.error;
    return;
  }

  stressTest.running = true;
  stressTest.success = 0;
  stressTest.failed = 0;
  stressTest.elapsedMs = 0;
  stressTest.aborted = false;

  const startTime = Date.now();
  const total = stressTest.total;
  const concurrency = stressTest.concurrency;
  const payload = {
    definitionRef: { definitionId, definitionHash },
    inputs: paramsParsed.value,
    options: optionsParsed.value,
    mergeGlobalFacts: providerJobForm.mergeGlobalFacts,
  };

  let dispatched = 0;

  async function worker(): Promise<void> {
    while (dispatched < total && !stressTest.aborted) {
      dispatched++;
      try {
        await providerSimulatorApi.triggerJob(payload);
        stressTest.success++;
      } catch {
        stressTest.failed++;
      }
      stressTest.elapsedMs = Date.now() - startTime;
    }
  }

  const workerCount = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  stressTest.elapsedMs = Date.now() - startTime;
  stressTest.running = false;

  const abortNote = stressTest.aborted ? '（已中止）' : '';
  ElMessage.success(
    `压测完成${abortNote}：成功 ${stressTest.success} / 失败 ${stressTest.failed}，耗时 ${(stressTest.elapsedMs / 1000).toFixed(2)}s`,
  );
}

async function loadProviderJobs() {
  providerJobsLoading.value = true;
  try {
    const res = await providerSimulatorApi.listJobs(50);
    providerJobs.value = res.items ?? [];
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerJobsLoading.value = false;
  }
}

function openProviderJob(row: any) {
  providerJobId.value = row.jobId;
  providerJobOpen.value = true;
  void refreshProviderJob();
}

async function refreshProviderJob() {
  if (!providerJobId.value) return;
  providerJobLoading.value = true;
  try {
    providerJobDetail.value = await providerSimulatorApi.getJob(providerJobId.value);
  } catch (e) {
    providerJobDetail.value = null;
    ElMessage.error(normalizeHttpError(e));
  } finally {
    providerJobLoading.value = false;
  }
}

function openDlqReplay() {
  dlqReplayOpen.value = true;
}

async function doDlqReplay() {
  dlqReplayLoading.value = true;
  try {
    const res = await backendApi.dlqReplay({
      limit: dlqReplayForm.limit,
      dryRun: dlqReplayForm.dryRun,
      minIntervalMs: dlqReplayForm.minIntervalMs,
    });
    ElMessage.success('已执行');
    dlqReplayOpen.value = false;
    await refreshDlq();
    // 结果很长：不直接弹出，留给后端日志/返回体查看
    console.log('dlqReplay result', res);
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    dlqReplayLoading.value = false;
  }
}

async function refreshAll() {
  await Promise.all([
    refreshOps(),
    refreshDefinitions(),
    refreshJobs(),
    settings.adminToken.trim() ? refreshDlq() : Promise.resolve(),
  ]);
}

onMounted(() => {
  void refreshAll();
  void searchProviderDefinitions('');
});
</script>

<style scoped>
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}
.k {
  opacity: 0.75;
}
.v {
  font-weight: 700;
}
.muted {
  opacity: 0.75;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
.box {
  max-height: 560px;
  overflow: auto;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
</style>
