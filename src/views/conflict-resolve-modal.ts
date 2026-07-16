import { App, Modal, normalizePath } from "obsidian";
import type FastSync from "../main";
import { $ } from "../i18n/lang";
import { hashContent, hashContentAsync, getPluginDir } from "../lib/utils/helpers";

/**
 * ConflictResolveModal provides a 3-column diff view for manual note conflict resolution.
 * ConflictResolveModal 提供三栏差异对比视图，供用户手动解决笔记同步冲突。
 */
export class ConflictResolveModal extends Modal {
  private plugin: FastSync;
  private file: any;
  private localContent: string;
  private serverContent: string;
  private baseContent: string;
  private serverHash: string;
  
  private editorEl: HTMLTextAreaElement;
  private resolved: boolean = false;

  public static activePaths: Set<string> = new Set();

  constructor(
    app: App,
    plugin: FastSync,
    file: any,
    localContent: string,
    serverContent: string,
    baseContent: string,
    serverHash: string
  ) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.localContent = localContent;
    this.serverContent = serverContent;
    this.baseContent = baseContent;
    this.serverHash = serverHash;
  }

  onOpen() {
    ConflictResolveModal.activePaths.add(this.file.path);
    this.containerEl.addClass("note-history-modal"); // 适配为历史版本同样大的大尺寸尺寸
    this.modalEl.addClass("conflict-resolve-modal");
    
    const { contentEl, titleEl } = this;
    
    // Render Title // 渲染标题
    titleEl.createSpan({ text: $("ui.conflict.modal_title") || "冲突合并" });
    titleEl.createDiv({ cls: "title-path", text: ` - ${this.file.path}` });

    const container = contentEl.createDiv({ cls: "conflict-resolve-container" });

    // 3-Column Diff View Wrap // 三栏对比视图包裹容器
    const diffWrap = container.createDiv({ cls: "conflict-resolve-diff-wrap" });
    diffWrap.style.display = "flex";
    diffWrap.style.gap = "12px";
    diffWrap.style.width = "100%";
    diffWrap.style.marginBottom = "16px";

    // Helper to build a column for comparing/editing content
    // 辅助构建用于比对或编辑的文本列
    const createColumn = (title: string, content: string, readOnly: boolean) => {
      const col = diffWrap.createDiv();
      col.style.flex = "1";
      col.style.display = "flex";
      col.style.flexDirection = "column";
      col.style.border = "1px solid var(--background-modifier-border)";
      col.style.borderRadius = "6px";
      col.style.padding = "8px";
      col.style.background = "var(--background-secondary)";

      // Header // 标题栏与一键复制
      const header = col.createDiv();
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.marginBottom = "8px";
      
      header.createEl("strong", { text: title });

      const copyBtn = header.createEl("button", { text: $("ui.history.copy") || "复制" });
      copyBtn.style.padding = "2px 8px";
      copyBtn.style.fontSize = "11px";
      copyBtn.onClickEvent(() => {
        navigator.clipboard.writeText(textarea.value);
        copyBtn.setText($("ui.history.copied") || "已复制");
        setTimeout(() => copyBtn.setText($("ui.history.copy") || "复制"), 2000);
      });

      // Textarea wrapper // 文本展示/编辑框
      const textarea = col.createEl("textarea");
      textarea.value = content;
      textarea.readOnly = readOnly;
      textarea.style.width = "100%";
      textarea.style.height = "320px";
      textarea.style.resize = "none";
      textarea.style.fontFamily = "var(--font-monospace)";
      textarea.style.fontSize = "12px";
      textarea.style.background = "var(--background-primary)";
      
      return { col, textarea };
    };

    // 计算本地和云端相对于共同基础版本 (Base) 的差异详情
    const localDiff = computeDiff(this.baseContent || "", this.localContent);
    const remoteDiff = computeDiff(this.baseContent || "", this.serverContent);

    // Render Local Version (Editable) // 渲染本地与共同基础版本的差异详情（可编辑，用户在此进行冲突调整）
    const localCol = createColumn(
      ($("ui.conflict.local_title") || "本地修改版本 (Local)") + " [可在此处直接修改解决]",
      localDiff,
      false // readOnly = false
    );
    this.editorEl = localCol.textarea;

    // Render Remote Version (ReadOnly) // 渲染云端与共同基础版本的差异详情（只读，仅供对照）
    const remoteCol = createColumn(
      $("ui.conflict.server_title") || "服务端修改版本 (Remote)",
      remoteDiff,
      true // readOnly = true
    );



    // Bottom Actions // 底部功能按钮行
    const actionEl = container.createDiv({ cls: "conflict-resolve-actions" });

    // Confirm Resolve Button // 确认解决
    const resolveBtn = actionEl.createEl("button", {
      text: "解决冲突",
      cls: "mod-cta"
    });
    resolveBtn.onClickEvent(async () => {
      this.resolved = true;
      resolveBtn.disabled = true;
      cancelBtn.disabled = true;

      try {
        const finalContent = cleanDiffMarkup(this.editorEl.value);

        // 1. Overwrite local file // 覆写本地文件
        await this.app.vault.modify(this.file, finalContent);

        // 2. Repush NoteModify marked as resolved // 向服务器发起携带 resolved 标志的推送
        const contentHash = await hashContentAsync(finalContent);
        const data = {
          vault: this.plugin.settings.vault,
          path: this.file.path,
          pathHash: hashContent(this.file.path),
          baseHash: this.serverHash,
          content: finalContent,
          contentHash: contentHash,
          ctime: this.file.stat.ctime,
          mtime: this.file.stat.mtime,
          isConflictResolved: true,
        };

        // Remove path from suppressed collection // 解除路径抑制
        this.plugin.syncState.conflictedPaths.delete(this.file.path);
        this.plugin.localStorageManager.setConflictedPaths(this.plugin.syncState.conflictedPaths);

        // 清理本地 conflict-notes 中的备份文件 (位于插件目录下，文件名附加路径哈希以防碰撞)
        try {
          const adapter = this.app.vault.adapter;
          const safeName = this.file.path.replace(/\.md$/, "").replace(/[\/\\]/g, "_");
          const pathHash = hashContent(this.file.path);
          const conflictDir = `${getPluginDir(this.plugin)}/conflict-notes`;
          const baseBackupPath = `${conflictDir}/${safeName}_${pathHash}.base.md`;
          const remoteBackupPath = `${conflictDir}/${safeName}_${pathHash}.remote.md`;
          
          const deletePromises: Promise<void>[] = [];
          if (await adapter.exists(baseBackupPath)) {
            deletePromises.push(adapter.remove(baseBackupPath));
          }
          if (await adapter.exists(remoteBackupPath)) {
            deletePromises.push(adapter.remove(remoteBackupPath));
          }
          await Promise.all(deletePromises);

          // 如果 conflict-notes 文件夹已空，则尝试一并清理（若被 Windows 锁定 busy 则静默忽略）
          if (await adapter.exists(conflictDir)) {
            const files = await adapter.list(conflictDir);
            if (files && files.files.length === 0 && files.folders.length === 0) {
              try {
                await adapter.rmdir(conflictDir, true);
              } catch (folderErr) {
                // Ignore EBUSY/locked folder error, keeping empty folder is harmless
              }
            }
          }
        } catch (e) {
          console.error("Failed to clean up conflict-notes files on resolve:", e);
        }
        
        await this.plugin.concurrencyLimiter.waitForSlot(this.file.path);
        void this.plugin.websocket.SendMessage("NoteModify", data);

        this.close();
      } catch (err) {
        console.error("Failed to resolve conflict:", err);
        resolveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    // Cancel Button // 稍后处理
    const cancelBtn = actionEl.createEl("button", {
      text: $("ui.button.cancel") || "稍后处理"
    });
    cancelBtn.onClickEvent(() => {
      this.close();
    });
  }

  onClose() {
    ConflictResolveModal.activePaths.delete(this.file.path);
    this.contentEl.empty();
  }
}

/**
 * Compute line-by-line Myers Diff between oldText and newText.
 * 计算旧文本和新文本之间的行级差异详情 (Git 格式)
 */
function computeDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const M = oldLines.length;
  const N = newLines.length;

  const dp: number[][] = Array.from({ length: M + 1 }, () => new Array(N + 1).fill(0));
  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = M, j = N;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push("  " + oldLines[i - 1]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push("+ " + newLines[j - 1]);
      j--;
    } else {
      result.push("- " + oldLines[i - 1]);
      i--;
    }
  }
  return result.reverse().join("\n");
}

/**
 * Cleans the Git-style diff markup to restore clean markdown content.
 * 清洗带 Git 差异标记的文本以还原纯净的 Markdown 笔记内容
 */
function cleanDiffMarkup(diffText: string): string {
  const lines = diffText.split(/\r?\n/);
  const cleanLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+ ") || line.startsWith("  ")) {
      cleanLines.push(line.substring(2));
    } else if (line.startsWith("- ")) {
      continue;
    } else {
      cleanLines.push(line);
    }
  }
  return cleanLines.join("\n");
}
