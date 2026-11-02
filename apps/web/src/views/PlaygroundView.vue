<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import { BubbleList, Conversations, XSender } from 'vue-element-plus-x';
import { ChatDotRound, Delete, Plus, RefreshRight, Setting } from '@element-plus/icons-vue';
import { keysApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';
import { renderMarkdown } from '../utils/markdown';
import { streamChat } from '../utils/sse';
import { formatNumber } from '../utils/format';

const auth = useAuthStore();
const keys = ref<any[]>([]);
const selectedKeyId = ref('');
const selectedModel = ref('');
const streaming = ref(false);
const senderRef = ref<any>();
const bubbleRef = ref<any>();
const controller = ref<AbortController | null>(null);
const paramsVisible = ref(false);
const params = reactive({
  system: '',
  temperature: 0.7,
  top_p: 1,
  max_tokens: 2048,
  stream: true,
});

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  placement: 'start' | 'end';
  loading?: boolean;
  error?: string | null;
  finishReason?: string | null;
  requestId?: string | null;
  usage?: any;
  createdAt: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  keyId: string;
  model: string;
  updatedAt: number;
}

const STORAGE_KEY = 'ag_playground_conversations';
const conversations = ref<Conversation[]>([]);
const activeId = ref('');

const activeKey = computed(() => keys.value.find((k) => k.id === selectedKeyId.value));
const availableModels = computed(() => activeKey.value?.models || []);
const activeConversation = computed(() => conversations.value.find((c) => c.id === activeId.value));
const messages = computed(() => activeConversation.value?.messages || []);

const conversationItems = computed(() =>
  conversations.value.map((c) => ({ id: c.id, label: c.title || '新会话' })),
);

const bubbleItems = computed(() =>
  messages.value.map((m) => ({
    ...m,
    content: m.content,
    placement: m.placement,
    loading: m.loading,
  })),
);

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) conversations.value = parsed;
    }
  } catch {
    conversations.value = [];
  }
}

function persist() {
  const data = conversations.value.map((c) => ({ ...c, updatedAt: Date.now() }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newConversation() {
  const conv: Conversation = {
    id: uid(),
    title: '新会话',
    messages: [],
    keyId: selectedKeyId.value,
    model: selectedModel.value,
    updatedAt: Date.now(),
  };
  conversations.value.unshift(conv);
  activeId.value = conv.id;
  persist();
}

function switchConversation(item: any) {
  if (!item?.id) return;
  activeId.value = item.id;
  const conv = conversations.value.find((c) => c.id === item.id);
  if (conv?.keyId) selectedKeyId.value = conv.keyId;
  if (conv?.model) selectedModel.value = conv.model;
}

function removeConversation() {
  if (!activeConversation.value) return;
  const index = conversations.value.findIndex((c) => c.id === activeId.value);
  conversations.value = conversations.value.filter((c) => c.id !== activeId.value);
  activeId.value = conversations.value[Math.max(0, index - 1)]?.id || '';
  if (!conversations.value.length) newConversation();
  persist();
}

function selectKey() {
  const models = availableModels.value;
  if (!models.some((m: any) => m.name === selectedModel.value)) {
    selectedModel.value = models[0]?.name || '';
  }
  if (activeConversation.value) {
    activeConversation.value.keyId = selectedKeyId.value;
    activeConversation.value.model = selectedModel.value;
    persist();
  }
}

function selectModel() {
  if (activeConversation.value) {
    activeConversation.value.model = selectedModel.value;
    persist();
  }
}

async function send(reuseUser = false) {
  const value = senderRef.value?.getModelValue?.();
  const text = String(value?.text || '').trim();
  if (!text) return;
  if (!selectedKeyId.value) {
    ElMessage.warning('请先选择一个 API Key');
    return;
  }
  if (!selectedModel.value) {
    ElMessage.warning('当前 Key 没有可用模型');
    return;
  }
  if (!activeConversation.value) newConversation();
  const conv = activeConversation.value!;
  senderRef.value?.clear?.();

  const userMessage: ChatMessage = {
    id: uid(),
    role: 'user',
    content: text,
    placement: 'end',
    createdAt: Date.now(),
  };
  const assistant = reactive<ChatMessage>({
    id: uid(),
    role: 'assistant',
    content: '',
    placement: 'start',
    loading: true,
    error: null,
    finishReason: null,
    requestId: null,
    usage: null,
    createdAt: Date.now(),
  });
  if (!reuseUser) conv.messages.push(userMessage);
  conv.messages.push(assistant);
  if (conv.title === '新会话') conv.title = text.slice(0, 28);
  conv.keyId = selectedKeyId.value;
  conv.model = selectedModel.value;
  persist();
  await nextTick();
  bubbleRef.value?.scrollToBottom?.(true);

  const payloadMessages: any[] = [];
  if (params.system.trim()) payloadMessages.push({ role: 'system', content: params.system.trim() });
  for (const m of conv.messages) {
    if (m === assistant) continue;
    if (m.role === 'system') continue;
    if (!m.content || m.error) continue;
    payloadMessages.push({ role: m.role, content: m.content });
  }

  const abort = new AbortController();
  controller.value = abort;
  streaming.value = true;

  try {
    await streamChat(
      '/api/admin/playground/chat',
      auth.token,
      {
        keyId: selectedKeyId.value,
        model: selectedModel.value,
        messages: payloadMessages,
        stream: params.stream,
        stream_options: params.stream ? { include_usage: true } : undefined,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
      },
      {
        onMeta: (meta) => {
          assistant.requestId = meta.requestId;
        },
        onDelta: (delta) => {
          assistant.content += delta;
          assistant.loading = true;
          bubbleRef.value?.scrollToBottom?.();
        },
        onUsage: (usage) => {
          assistant.usage = usage;
        },
        onFinish: (reason) => {
          assistant.finishReason = reason;
          if (reason === 'content_filter') {
            ElMessage.warning('输出内容触发敏感策略，已被拦截');
          }
        },
        onError: (message, code) => {
          assistant.error = message;
          if (!assistant.content) assistant.content = message;
          ElMessage.error(code ? `${message}（${code}）` : message);
        },
      },
      abort.signal,
    );
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      assistant.error = e.message || '请求失败';
      if (!assistant.content) assistant.content = assistant.error;
      ElMessage.error(assistant.error || '请求失败');
    }
  } finally {
    assistant.loading = false;
    streaming.value = false;
    controller.value = null;
    persist();
    await nextTick();
    bubbleRef.value?.scrollToBottom?.(true);
  }
}

function stop() {
  controller.value?.abort();
  streaming.value = false;
}

async function regenerate() {
  const conv = activeConversation.value;
  if (!conv || streaming.value) return;
  const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') {
    conv.messages.pop();
  }
  senderRef.value?.setText?.(lastUser.content);
  await nextTick();
  await send(true);
}

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('复制失败，请手动选择文本');
  }
}

watch([selectedKeyId, selectedModel], () => {
  if (activeConversation.value) {
    activeConversation.value.keyId = selectedKeyId.value;
    activeConversation.value.model = selectedModel.value;
    persist();
  }
});

onMounted(async () => {
  loadLocal();
  try {
    keys.value = (await keysApi.list()).filter(
      (k: any) => k.status === 'ACTIVE' && Array.isArray(k.models) && k.models.length > 0,
    );
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }

  const usable = keys.value.filter(
    (k: any) => !k.quotaRequests || Number(k.usedRequests) < Number(k.quotaRequests),
  );
  const preferred =
    keys.value.find((k: any) => k.name === 'demo-key') ||
    usable[0] ||
    keys.value[0];

  if (!conversations.value.length) {
    newConversation();
  } else {
    const first = conversations.value[0];
    activeId.value = first.id;
    const storedKey = keys.value.find((k: any) => k.id === first.keyId);
    selectedKeyId.value = storedKey?.id || preferred?.id || '';
    selectedModel.value = storedKey?.models?.some((m: any) => m.name === first.model)
      ? first.model
      : storedKey?.models?.[0]?.name || '';
  }
  if (!selectedKeyId.value && preferred) {
    selectedKeyId.value = preferred.id;
    selectKey();
  } else {
    selectKey();
  }
});

onBeforeUnmount(() => {
  controller.value?.abort();
  persist();
});
</script>

<template>
  <div class="playground">
    <div class="playground-head">
      <div>
        <h2 class="page-title">在线调试</h2>
        <p class="page-subtitle">使用真实 Key 走完整网关链路：鉴权、模型白名单、限流、敏感拦截与日志</p>
      </div>
      <div class="head-actions">
        <el-select v-model="selectedKeyId" placeholder="选择 API Key" style="width: 210px" @change="selectKey">
          <el-option v-for="k in keys" :key="k.id" :label="`${k.name} · ${k.maskedKey}`" :value="k.id" />
        </el-select>
        <el-select v-model="selectedModel" placeholder="选择模型" style="width: 190px" @change="selectModel">
          <el-option v-for="m in availableModels" :key="m.id" :label="m.name" :value="m.name" />
        </el-select>
        <el-button :icon="Setting" @click="paramsVisible = true">参数</el-button>
      </div>
    </div>

    <el-alert
      v-if="!keys.length"
      type="warning"
      :closable="false"
      show-icon
      title="还没有可用的 API Key，请先到「Key 管理」签发一个。"
      class="empty-alert"
    />
    <el-alert
      v-else-if="selectedKeyId && !availableModels.length"
      type="warning"
      :closable="false"
      show-icon
      title="当前 Key 没有授权任何模型，请先在 Key 管理中追加模型。"
      class="empty-alert"
    />

    <div class="chat-shell">
      <aside class="conversation-pane">
        <div class="conversation-head">
          <span>会话</span>
          <div>
            <el-button text circle size="small" :icon="Plus" @click="newConversation" />
            <el-button text circle size="small" :icon="Delete" @click="removeConversation" />
          </div>
        </div>
        <Conversations
          :active="activeId"
          :items="conversationItems"
          :show-built-in-menu="false"
          :label-max-width="150"
          @change="switchConversation"
        />
        <div class="conversation-tip">
          <el-icon><ChatDotRound /></el-icon>
          会话保存在本地浏览器
        </div>
      </aside>

      <section class="chat-pane">
        <div class="chat-toolbar">
          <div class="chat-model">
            <span class="dot"></span>
            {{ selectedModel || '未选择模型' }}
            <el-tag v-if="activeKey" size="small" effect="plain">{{ activeKey.name }}</el-tag>
          </div>
          <div class="chat-actions">
            <el-button text size="small" :icon="RefreshRight" :disabled="streaming" @click="regenerate">重新生成</el-button>
          </div>
        </div>

        <div class="bubble-area">
          <div v-if="!messages.length" class="chat-empty">
            <div class="empty-icon"><el-icon><ChatDotRound /></el-icon></div>
            <h3>开始一次真实调用</h3>
            <p>选择 Key 和模型，输入内容即可测试流式输出、Token 统计与敏感拦截。</p>
            <div class="empty-prompt" @click="senderRef?.setText?.('你好，请用三句话介绍你自己')">
              你好，请用三句话介绍你自己
            </div>
          </div>
          <BubbleList
            v-else
            ref="bubbleRef"
            :list="bubbleItems"
            :max-height="'calc(100vh - 300px)'"
            :auto-scroll="true"
            :show-back-button="true"
          >
            <template #content="{ item }">
              <div v-if="item.role === 'user'" class="user-message">{{ item.content }}</div>
              <div v-else class="markdown-body" v-html="renderMarkdown(item.content)"></div>
              <div v-if="item.error" class="message-error">{{ item.error }}</div>
            </template>
            <template #footer="{ item }">
              <div v-if="item.role === 'assistant' && !item.loading" class="message-meta">
                <el-tag v-if="item.finishReason === 'content_filter'" size="small" type="danger">敏感拦截</el-tag>
                <span v-if="item.usage">Token {{ formatNumber(item.usage.total_tokens || item.usage.totalTokens) }}</span>
                <span v-if="item.requestId" class="mono">{{ item.requestId.slice(0, 18) }}</span>
                <el-button text size="small" @click="copyMessage(item.content)">复制</el-button>
              </div>
            </template>
          </BubbleList>
        </div>

        <div class="sender-area">
          <XSender
            ref="senderRef"
            :loading="streaming"
            :disabled="!selectedKeyId || !availableModels.length"
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            :max-length="12000"
            @submit="() => send()"
            @cancel="stop"
          />
          <div class="sender-tip">
            <span>调用会消耗所选 Key 的配额，并记录到调用日志。</span>
            <span v-if="streaming" class="streaming-state">正在生成…</span>
          </div>
        </div>
      </section>
    </div>

    <el-drawer v-model="paramsVisible" title="对话参数" size="420px">
      <el-form label-position="top">
        <el-form-item label="System Prompt">
          <el-input v-model="params.system" type="textarea" :rows="4" placeholder="可选；会作为 system 消息发送" />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-slider v-model="params.temperature" :min="0" :max="2" :step="0.1" show-input />
        </el-form-item>
        <el-form-item label="Top P">
          <el-slider v-model="params.top_p" :min="0" :max="1" :step="0.05" show-input />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="params.max_tokens" :min="1" :max="128000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="流式输出">
          <el-switch v-model="params.stream" />
        </el-form-item>
      </el-form>
    </el-drawer>
  </div>
</template>

<style scoped>
.playground {
  height: calc(100vh - 128px);
  display: flex;
  flex-direction: column;
}

.playground-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 14px;
}

.head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.empty-alert {
  margin-bottom: 12px;
}

.chat-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 238px 1fr;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.conversation-pane {
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 10px;
}

.conversation-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 6px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.conversation-tip {
  margin-top: auto;
  padding: 12px 8px 2px;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  display: flex;
  align-items: center;
  gap: 5px;
}

.chat-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-toolbar {
  height: 48px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.chat-model {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 650;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}

.bubble-area {
  flex: 1;
  min-height: 0;
  padding: 18px 24px 8px;
  overflow: hidden;
}

.chat-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.empty-icon {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.14), rgba(99, 102, 241, 0.14));
  color: #6366f1;
  font-size: 25px;
  margin-bottom: 14px;
}

.chat-empty h3 {
  margin: 0 0 8px;
  color: var(--el-text-color-primary);
  font-size: 18px;
  letter-spacing: -0.02em;
}

.chat-empty p {
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
  max-width: 390px;
}

.empty-prompt {
  margin-top: 18px;
  padding: 9px 14px;
  border-radius: 999px;
  border: 1px solid var(--el-border-color);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.empty-prompt:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.sender-area {
  padding: 10px 20px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.sender-tip {
  display: flex;
  justify-content: space-between;
  padding: 6px 4px 0;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.streaming-state {
  color: var(--el-color-primary);
}

.user-message {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
}

.markdown-body {
  font-size: 13px;
  line-height: 1.75;
  word-break: break-word;
}

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(pre) {
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 8px;
  padding: 12px;
  overflow: auto;
  font-size: 11px;
}

.markdown-body :deep(code) {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.markdown-body :deep(:not(pre) > code) {
  background: var(--el-fill-color);
  padding: 1px 5px;
  border-radius: 4px;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.message-error {
  margin-top: 6px;
  color: var(--el-color-danger);
  font-size: 11px;
}

.mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
}
</style>
