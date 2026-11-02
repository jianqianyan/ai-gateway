<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'blue' | 'green' | 'violet' | 'orange' | 'red' | 'slate';
}>();
</script>

<template>
  <div class="stat-card" :class="`tone-${tone || 'blue'}`">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.stat-card {
  position: relative;
  overflow: hidden;
  padding: 18px 20px;
  border-radius: 14px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  min-height: 112px;
}

.stat-card::after {
  content: '';
  position: absolute;
  width: 90px;
  height: 90px;
  right: -30px;
  top: -35px;
  border-radius: 999px;
  opacity: 0.18;
  background: var(--accent);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 10px;
}

.stat-value {
  font-size: 28px;
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.stat-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 9px;
}

.tone-blue { --accent: #3b82f6; }
.tone-green { --accent: #10b981; }
.tone-violet { --accent: #8b5cf6; }
.tone-orange { --accent: #f59e0b; }
.tone-red { --accent: #ef4444; }
.tone-slate { --accent: #64748b; }
</style>
