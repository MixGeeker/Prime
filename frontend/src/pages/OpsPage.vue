<template>
  <el-card class="card">
    <template #header>
      <div class="hdr">
        <div>Ops（仪表盘）</div>
        <el-button :loading="loadingAll" @click="refreshAll">刷新全部</el-button>
      </div>
    </template>

    <div class="muted" style="margin-bottom: 12px">
      此页面只展示 Compute Engine 侧状态；Job 触发与结果回写由 SDK / 业务模块负责。
    </div>

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
              <el-button :disabled="!dlqEnabled" :loading="dlqLoading" @click="refreshDlq">刷新</el-button>
              <el-button type="warning" :disabled="!dlqEnabled || !dlqStats" @click="openDlqReplay">replay</el-button>
            </div>
            <div class="muted">
              {{ dlqEnabled ? '需要后端启用危险端点。' : '请先在设置页填写 Admin Token。' }}
            </div>
            <div v-if="dlqError" class="err">{{ dlqError }}</div>
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
          <el-button :loading="jobsLoading" @click="refreshJobs">搜索/刷新</el-button>
        </div>

        <el-table :data="jobs" size="small" height="520px" stripe @row-click="openJob">
          <el-table-column prop="jobId" label="jobId" min-width="240" />
          <el-table-column prop="definitionId" label="definitionId" min-width="200" />
          <el-table-column label="hash" min-width="180">
            <template #default="{ row }">
              <span class="mono muted">{{ row.definitionHashUsed ? row.definitionHashUsed.slice(0, 12) + '…' : '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="status" width="110" />
          <el-table-column prop="requestedAt" label="requestedAt" min-width="200" />
          <el-table-column prop="errorCode" label="errorCode" min-width="180" />
        </el-table>

        <div class="row" style="margin-top: 10px">
          <el-button :disabled="!jobsNextCursor" :loading="jobsLoadingMore" @click="loadMoreJobs">
            加载更多
          </el-button>
          <span v-if="!jobsNextCursor" class="muted">已到底</span>
        </div>
      </el-tab-pane>

      <el-tab-pane label="DLQ" name="dlq">
        <el-card>
          <template #header>
            <div class="hdr">
              <div>job-requested DLQ</div>
              <div class="row">
                <el-button :disabled="!dlqEnabled" :loading="dlqLoading" @click="refreshDlq">刷新</el-button>
                <el-button type="warning" :disabled="!dlqEnabled || !dlqStats" @click="openDlqReplay">replay</el-button>
              </div>
            </div>
          </template>

          <div v-if="!dlqEnabled" class="muted">请先在设置页填写 Admin Token，然后再访问危险运维端点。</div>
          <pre v-else-if="dlqStats" class="mono box">{{ JSON.stringify(dlqStats, null, 2) }}</pre>
          <div v-else class="muted">暂无数据。</div>
          <div v-if="dlqError" class="err" style="margin-top: 8px">{{ dlqError }}</div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-drawer v-model="releasesOpen" title="Releases" size="65%">
    <div class="row" style="margin-bottom: 10px">
      <div class="muted">definitionId: {{ releasesDefinitionId }}</div>
      <el-button :loading="releasesLoading" @click="openReleases(releasesDefinitionId)">刷新</el-button>
    </div>
    <el-table :data="releases" size="small" height="520px" stripe>
      <el-table-column prop="definitionHash" label="definitionHash" min-width="300" />
      <el-table-column prop="status" label="status" width="120" />
      <el-table-column prop="publishedAt" label="publishedAt" min-width="200" />
      <el-table-column prop="deprecatedAt" label="deprecatedAt" min-width="200" />
      <el-table-column prop="changelog" label="changelog" min-width="220" />
    </el-table>
  </el-drawer>

  <el-drawer v-model="jobOpen" title="Job Detail" size="55%">
    <div class="row" style="margin-bottom: 10px">
      <div class="muted">jobId: {{ jobId }}</div>
      <el-button :loading="jobLoading" @click="refreshJobDetail">刷新</el-button>
    </div>
    <pre v-if="jobDetail" class="mono box">{{ JSON.stringify(jobDetail, null, 2) }}</pre>
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
import type { DefinitionSummary } from '@/engine/types';
import { useSettingsStore } from '@/stores/settings';

const router = useRouter();
const settings = useSettingsStore();

const tab = ref<'overview' | 'definitions' | 'jobs' | 'dlq'>('overview');

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
const jobsStatus = ref<'requested' | 'running' | 'succeeded' | 'failed' | null>(null);
const jobsDefinitionId = ref('');
const jobs = ref<any[]>([]);
const jobsNextCursor = ref<string | null>(null);

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

const dlqEnabled = computed(() => Boolean(settings.adminToken.trim()));
const loadingAll = computed(() => opsLoading.value || defsLoading.value || jobsLoading.value || dlqLoading.value);

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
  if (!dlqEnabled.value) return;
  dlqLoading.value = true;
  dlqError.value = null;
  try {
    dlqStats.value = await backendApi.dlqStats();
  } catch (e) {
    dlqStats.value = null;
    dlqError.value = normalizeHttpError(e);
  } finally {
    dlqLoading.value = false;
  }
}

async function refreshDefinitions() {
  defsLoading.value = true;
  try {
    const res = await backendApi.listDefinitions({
      q: defsQuery.value.trim() || undefined,
      limit: 50,
    });
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
      q: defsQuery.value.trim() || undefined,
      limit: 50,
      cursor: defsNextCursor.value,
    });
    definitions.value = [...definitions.value, ...(res.items ?? [])];
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
      status: jobsStatus.value ?? undefined,
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
      status: jobsStatus.value ?? undefined,
      definitionId: jobsDefinitionId.value.trim() || undefined,
    });
    jobs.value = [...jobs.value, ...(res.items ?? [])];
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
  if (!definitionId) return;
  releasesDefinitionId.value = definitionId;
  releasesOpen.value = true;
  releasesLoading.value = true;
  try {
    releases.value = await backendApi.listReleases(definitionId);
  } catch (e) {
    releases.value = [];
    ElMessage.error(normalizeHttpError(e));
  } finally {
    releasesLoading.value = false;
  }
}

async function openJob(row: any) {
  jobId.value = row.jobId;
  jobOpen.value = true;
  await refreshJobDetail();
}

async function refreshJobDetail() {
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

function openDlqReplay() {
  dlqReplayOpen.value = true;
}

async function doDlqReplay() {
  dlqReplayLoading.value = true;
  try {
    const result = await backendApi.dlqReplay({
      limit: dlqReplayForm.limit,
      dryRun: dlqReplayForm.dryRun,
      minIntervalMs: dlqReplayForm.minIntervalMs,
    });
    ElMessage.success('已执行');
    dlqReplayOpen.value = false;
    await refreshDlq();
    console.log('dlqReplay result', result);
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
    dlqEnabled.value ? refreshDlq() : Promise.resolve(),
  ]);
}

onMounted(() => {
  void refreshAll();
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
.box {
  max-height: 560px;
  overflow: auto;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
.err {
  color: var(--el-color-danger);
}
</style>
