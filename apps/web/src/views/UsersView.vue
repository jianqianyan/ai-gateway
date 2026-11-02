<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Edit, Delete } from '@element-plus/icons-vue';
import { usersApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { formatDate, statusLabels, statusType } from '../utils/format';

const loading = ref(false);
const users = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref<any>(null);
const saving = ref(false);
const form = reactive<any>({
  username: '',
  password: '',
  displayName: '',
  role: 'VIEWER',
  status: 'ACTIVE',
});

async function load() {
  loading.value = true;
  try {
    users.value = await usersApi.list();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { username: '', password: '', displayName: '', role: 'VIEWER', status: 'ACTIVE' });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    username: row.username,
    password: '',
    displayName: row.displayName || '',
    role: row.role,
    status: row.status,
  });
  dialogVisible.value = true;
}

async function save() {
  if (!editing.value && (!form.username || !form.password)) {
    ElMessage.warning('请输入用户名和初始密码');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      const payload: any = {
        displayName: form.displayName,
        role: form.role,
        status: form.status,
      };
      if (form.password) payload.password = form.password;
      await usersApi.update(editing.value.id, payload);
      ElMessage.success('账号已更新');
    } else {
      await usersApi.create({
        username: form.username,
        password: form.password,
        displayName: form.displayName,
        role: form.role,
      });
      ElMessage.success('账号已创建');
    }
    dialogVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确定删除账号「${row.username}」？`, '删除账号', { type: 'warning' });
  try {
    await usersApi.remove(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">账号管理</h2>
        <p class="page-subtitle">管理控制台登录账号；API 调用方使用 Key 管理中的网关 Key</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建账号</el-button>
    </div>

    <div class="page-card">
      <el-table v-loading="loading" :data="users">
        <el-table-column prop="username" label="用户名" min-width="160">
          <template #default="{ row }"><span class="mono">{{ row.username }}</span></template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名" min-width="150" />
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 'ADMIN' ? 'danger' : 'info'" effect="plain">
              {{ statusLabels[row.role] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabels[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="180">
          <template #default="{ row }">{{ row.lastLoginAt ? formatDate(row.lastLoginAt) : '-' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑账号' : '新建账号'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="Boolean(editing)" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" />
        </el-form-item>
        <el-form-item :label="editing ? '重置密码' : '初始密码'" :required="!editing">
          <el-input v-model="form.password" type="password" show-password :placeholder="editing ? '留空不修改' : '至少 8 位'" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio-button value="ADMIN">管理员</el-radio-button>
            <el-radio-button value="VIEWER">只读用户</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editing" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="ACTIVE">启用</el-radio-button>
            <el-radio-button value="DISABLED">禁用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
}
</style>
