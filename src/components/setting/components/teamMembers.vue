<template>
  <t-loading :loading="loading">
    <div class="teamMembers">
      <t-alert theme="info" message="团队成员共用项目访问权限；写操作仍由服务端按角色和版本校验。" />
      <t-alert v-if="error" theme="warning" :message="error" class="mt-12" />

      <div v-if="user" class="currentUser mt-12">
        <div>
          <strong>{{ user.name }}</strong>
          <span class="muted">当前账号</span>
        </div>
        <div class="capabilities">
          <t-tag>{{ roleLabel(user.role) }}</t-tag>
          <t-tag :theme="user.enabled ? 'success' : 'danger'" variant="light">{{ user.enabled ? "已启用" : "已禁用" }}</t-tag>
          <span class="muted">{{ capabilityText }}</span>
        </div>
      </div>

      <template v-if="canManageMembers">
        <div class="sectionHeader mt-16">
          <div>
            <strong>团队成员</strong>
            <span class="muted">{{ users.length }} 人</span>
          </div>
          <t-space>
            <t-button variant="outline" :loading="loading" @click="refresh">刷新</t-button>
            <t-button theme="primary" @click="openCreate">新增成员</t-button>
          </t-space>
        </div>
        <div v-if="users.length" class="memberList">
          <div v-for="member in users" :key="member.id" class="memberRow">
            <div class="memberIdentity">
              <strong>{{ member.name }}</strong>
              <span class="muted">#{{ member.id }} · 版本 {{ member.version }}</span>
            </div>
            <div class="memberActions">
              <t-tag>{{ roleLabel(member.role) }}</t-tag>
              <t-tag :theme="member.enabled ? 'success' : 'danger'" variant="light">{{ member.enabled ? "已启用" : "已禁用" }}</t-tag>
              <t-button size="small" variant="outline" @click="openEdit(member)">编辑</t-button>
            </div>
          </div>
        </div>
        <t-empty v-else description="暂无团队成员" />
      </template>
      <t-empty v-else-if="user" class="mt-16" description="当前账号没有成员管理权限" />

      <t-dialog
        v-model:visible="editorVisible"
        :header="editingUser ? '编辑团队成员' : '新增团队成员'"
        :confirm-btn="{ content: editingUser ? '保存' : '创建', loading: saving }"
        cancel-btn="取消"
        @confirm="submitEditor"
        @cancel="closeEditor"
        @close="closeEditor">
        <t-form :data="editor" label-align="top">
          <t-form-item label="名称">
            <t-input v-model="editor.name" placeholder="请输入成员名称" />
          </t-form-item>
          <t-form-item v-if="!editingUser" label="密码">
            <t-input v-model="editor.password" type="password" placeholder="请输入初始密码" />
          </t-form-item>
          <t-form-item label="角色">
            <t-select v-model="editor.role" :options="roleOptions" />
          </t-form-item>
          <t-form-item v-if="editingUser" label="状态">
            <t-switch v-model="editor.enabled" :custom-value="[true, false]" />
            <span class="switchLabel">{{ editor.enabled ? "启用" : "禁用" }}</span>
          </t-form-item>
        </t-form>
      </t-dialog>
    </div>
  </t-loading>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import teamStore from "@/stores/team";
import type { TeamRole, TeamUser } from "@/types/team";

const store = teamStore();
const { user, capabilities, users, loading, error } = storeToRefs(store);
const editorVisible = ref(false);
const saving = ref(false);
const editingUser = ref<TeamUser | null>(null);
const editor = reactive<{ name: string; password: string; role: TeamRole; enabled: boolean }>({
  name: "",
  password: "",
  role: "viewer",
  enabled: true,
});
const roleOptions = [
  { label: "管理员", value: "admin" },
  { label: "制作成员", value: "editor" },
  { label: "只读成员", value: "viewer" },
];
const canManageMembers = computed(() => capabilities.value.manageMembers === true);
const capabilityText = computed(() => {
  const items = [];
  if (capabilities.value.edit) items.push("可编辑");
  if (capabilities.value.review) items.push("可审核");
  if (capabilities.value.manageMembers) items.push("可管理成员");
  return items.length ? items.join("、") : "仅可查看本人能力";
});

function roleLabel(role: TeamRole): string {
  return role === "admin" ? "管理员" : role === "editor" ? "制作成员" : "只读成员";
}

async function refresh() {
  try {
    await store.refresh();
  } catch {
    // The error alert is rendered from the store; this also supports a pending backend/stub.
  }
}

function openCreate() {
  editingUser.value = null;
  Object.assign(editor, { name: "", password: "", role: "viewer", enabled: true });
  editorVisible.value = true;
}

function openEdit(member: TeamUser) {
  editingUser.value = member;
  Object.assign(editor, { name: member.name, password: "", role: member.role, enabled: member.enabled });
  editorVisible.value = true;
}

function closeEditor() {
  editorVisible.value = false;
  editingUser.value = null;
}

async function submitEditor() {
  if (!editor.name.trim()) return window.$message.warning("请输入成员名称");
  if (!editingUser.value && editor.password.length < 8) return window.$message.warning("初始密码至少需要 8 位");
  saving.value = true;
  try {
    if (editingUser.value) {
      await store.updateUser({
        id: editingUser.value.id,
        expectedVersion: editingUser.value.version,
        name: editor.name.trim(),
        role: editor.role,
        enabled: editor.enabled,
      });
      window.$message.success("成员已更新");
    } else {
      await store.createUser({ name: editor.name.trim(), password: editor.password, role: editor.role });
      window.$message.success("成员已创建");
    }
    closeEditor();
    await refresh();
  } catch (reason: any) {
    window.$message.error(reason?.message ?? "成员操作失败");
  } finally {
    saving.value = false;
  }
}

onMounted(() => void refresh());
</script>

<style scoped lang="scss">
.teamMembers {
  min-height: 300px;
}
.mt-12 {
  margin-top: 12px;
}
.mt-16 {
  margin-top: 16px;
}
.currentUser,
.sectionHeader,
.memberRow,
.capabilities,
.memberActions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.currentUser,
.sectionHeader,
.memberRow {
  justify-content: space-between;
}
.currentUser,
.memberRow {
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 6px;
  padding: 10px 12px;
}
.currentUser {
  background: var(--td-bg-color-container-hover);
}
.memberList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.memberIdentity {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.muted {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
}
.switchLabel {
  margin-left: 8px;
}
</style>
