import { moment, Platform } from "obsidian";

import { handleFileChunkDownload, BINARY_PREFIX_FILE_SYNC, clearUploadQueue } from "./operator_file";
import { dump, addRandomParam, showSyncNotice, safeStringify } from "../utils/helpers";
import { enSendDTOToProtobuf, deReceivePacket } from "../../pb/protobuf_mapper";
import { receiveOperators, startupSync, startupFullSync } from "./operator";
import { SyncLogManager } from "./sync_log_manager";
import * as WSAction from "./websocket_action";
import { WebSocketClient } from "./websocket_client";
import { CLIENT_TYPE } from "../utils/types";
import type FastSync from "../../main";
import { $ } from "../../i18n/lang";


// 冲突相关错误码
const ERROR_SYNC_CONFLICT = 530;

const AUTH_ERROR_REIMPORT_CODES = new Set([307, 308, 309, 310]);

const AUTH_ERROR_FALLBACK_MESSAGES: Record<number, string> = {
  307: "Authorization token is missing",
  308: "Session expired or token has been revoked",
  309: "Authorization token is invalid or incomplete",
  310: "Authorization token has expired",
  312: "Authorization token is restricted by IP",
  313: "Authorization token is restricted by user agent",
  314: "Authorization token is restricted by client",
  315: "Authorization token scope is restricted",
};

export interface StructuredMessageData {
  code: number;
  status?: boolean;
  message?: string;
  details?: string;
  data?: Record<string, unknown> | null;
  vault?: string;
  context?: string; // 当前同步上下文 / Current sync context
}

function normalizeNoticeValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeNoticeValue(item))
      .filter(Boolean)
      .join(", ");
  }

  const text = safeStringify(value).trim();
  return text === "undefined" ? "" : text;
}

export function formatAuthorizationError(data: StructuredMessageData): string {
  const message = normalizeNoticeValue(data.message) || AUTH_ERROR_FALLBACK_MESSAGES[data.code] || "Authorization failed";
  const details = normalizeNoticeValue(data.details);
  const detailsText = details ? " Details=" + details : "";
  const authFailureText = (message + " " + details).toLowerCase();
  const needsReimportHint = AUTH_ERROR_REIMPORT_CODES.has(data.code) ||
    authFailureText.includes("rotated") ||
    authFailureText.includes("revoked") ||
    authFailureText.includes("no longer exists") ||
    authFailureText.includes("missing");
  const hint = needsReimportHint ? " Hint=Please re-import the API configuration from the management console." : "";

  return "Service Authorization Error: Code=" + data.code + " Msg=" + message + detailsText + hint;
}

export class WebSocketManager {
  public client: WebSocketClient;
  private plugin: FastSync;
  private currentStartHandleId = 0;

  constructor(plugin: FastSync) {
    this.plugin = plugin;
    this.client = new WebSocketClient(this.plugin, {
      getWsUrl: (count) => {
        const client = CLIENT_TYPE;
        const clientName = encodeURIComponent(this.plugin.getClientName());
        const clientVersion = this.plugin.manifest.version || "";
        // Always include protocol=protobuf regardless of settings
        // 无论设置如何，始终包含 protocol=protobuf 参数
        const useProtoParam = "&protocol=protobuf";
        return addRandomParam(
          this.plugin.runWsApi +
          "/api/user/sync?lang=" +
          moment.locale() +
          "&count=" +
          count +
          "&client=" +
          client +
          "&clientName=" +
          clientName +
          "&clientVersion=" +
          clientVersion +
          useProtoParam
        );
      },
      preConnectProbe: async () => {
        const needProbe = this.plugin.settings.autoRedirectEnabled || this.plugin.settings.wsPreProbeEnabled;
        if (needProbe) {
          return await this.plugin.api.probeApiRedirect(this.plugin.runApi);
        }
        return true;
      },
      onOpen: (client) => {
        client.Send(WSAction.ClientReceiveAuth, this.plugin.settings.apiToken);
        dump("Service authorization");
      },
      onClose: (client, code, reason) => {
        if (this.plugin.isSyncing) {
          this.plugin.isSyncing = false;
          this.plugin.isSyncRequesting = false;
        }
        clearUploadQueue();
        this.plugin.concurrencyLimiter.clear();
      },
      onMessage: (client, action, data) => {
        this.handleStructuredMessage(action, data);
      },
      serializeMessage: (action, payload) => {
        return enSendDTOToProtobuf(action, payload);
      },
      deserializeMessage: (data) => {
        return deReceivePacket(data) as unknown as { action: string;[key: string]: unknown };
      },
    });

    // 绑定大流量下载 binary handler
    this.client.registerBinaryHandler(BINARY_PREFIX_FILE_SYNC, (data) => {
      void handleFileChunkDownload(data, this.plugin);
    });
  }

  // 代理一些 WebSocketClient 的方法和属性以保持向后兼容性
  public get ws(): WebSocket | null {
    return this.client.ws;
  }
  public get isOpen(): boolean {
    return this.client.isOpen;
  }
  public get isAuth(): boolean {
    return this.client.isAuth;
  }
  public set isAuth(val: boolean) {
    this.client.isAuth = val;
  }
  public get useProtobuf(): boolean {
    return this.client.useProtobuf;
  }
  public get isRegister(): boolean {
    return this.client.isRegister;
  }
  public set isRegister(val: boolean) {
    this.client.isRegister = val;
  }
  public get count(): number {
    return this.client.count;
  }

  public addStatusListener(listener: (status: boolean) => void) {
    this.client.addStatusListener(listener);
  }
  public removeStatusListener(listener: (status: boolean) => void) {
    this.client.removeStatusListener(listener);
  }
  public addActivityListener(listener: () => void) {
    this.client.addActivityListener(listener);
  }
  public register() {
    return this.client.register();
  }
  public unRegister(setUnregistered = false) {
    this.client.unRegister(setUnregistered);
  }
  public isConnected(): boolean {
    return this.client.isConnected();
  }
  public triggerReconnect() {
    this.client.triggerReconnect();
  }
  public SendMessage(action: WSAction.WSSendAction, data: unknown, before?: () => boolean, after?: () => void) {
    return this.client.SendMessage(action, data, before, after);
  }
  public Send(action: WSAction.WSSendAction, data: unknown, after?: () => void) {
    this.client.Send(action, data, after);
  }
  public SendBinary(data: ArrayBuffer | Uint8Array, prefix: string, before?: () => boolean, after?: () => void) {
    return this.client.SendBinary(data, prefix, before, after);
  }

  private isStructuredMessageData(obj: unknown): obj is StructuredMessageData {
    if (typeof obj !== "object" || obj === null) {
      return false;
    }
    const record = obj as Record<string, unknown>;
    return typeof record.code === "number";
  }

  private handleStructuredMessage(msgAction: string, data: unknown) {
    if (!this.isStructuredMessageData(data)) {
      return;
    }

    // 记录接收到的消息
    if (msgAction) {
      SyncLogManager.getInstance().logReceivedMessage(msgAction, data, this.plugin.currentSyncType);
    }

    if (msgAction === WSAction.ClientReceiveAuth) {
      if (data.code <= 0 || data.code >= 300) {
        showSyncNotice(formatAuthorizationError(data), 6000);
        return;
      } else {
        this.client.isAuth = true;
        const paths = (data.data?.["paths"] as string[]) || [];
        this.plugin.shareIndicatorManager?.updateSharedPaths(paths);
        if (data.data) {
          const serverVersion = (data.data["version"] as string) ?? this.plugin.localStorageManager.getMetadata("serverVersion");
          const serverChangelog = (data.data["changelog"] as string) ?? this.plugin.localStorageManager.getMetadata("serverChangelog");
          this.plugin.localStorageManager.setMetadata("serverVersion", serverVersion);
          this.plugin.localStorageManager.setMetadata("serverChangelog", serverChangelog);
        }
        dump("Service authorization success");
        this.client.notifyStatusChange(true);

        this.sendClientInfo();
        void this.StartHandle();
      }
      return;
    }

    if (msgAction === WSAction.ClientReceiveInfo) {
      if (data.code <= 0 || data.code >= 300) {
        return;
      } else {
        if (data.data) {
          this.plugin.versionManager.updateFromClientInfo(data.data);
        }
      }
      return;
    }

    if (data.code <= 0 || data.code >= 300) {
      // 处理冲突相关错误码
      if (data.code === ERROR_SYNC_CONFLICT) {
        this.handleConflictError(data);
      } else {
        const errorMsg = data.message || "";
        const errorDetails = data.details ? " Details=" + data.details : "";
        showSyncNotice("Service Error: Code=" + data.code + " Message=" + errorMsg + errorDetails);
      }
    } else {
      if (typeof data === "object" && "vault" in data && data.vault != null && data.vault !== "" && data.vault !== this.plugin.settings.vault) {
        dump("Service vault " + data.vault + " not match " + this.plugin.settings.vault);
        return;
      }

      // 基于 Context 进行过滤：如果处于活跃的同步中，且业务消息包含 context，则必须匹配
      // Filter based on Context: if there's an active sync context and incoming business message has a context, it must match
      if (this.plugin.syncState.activeSyncContext) {
        const isControlMsg = msgAction === WSAction.ClientReceiveAuth || msgAction === WSAction.ClientReceiveInfo;
        if (!isControlMsg && data.context && data.context !== this.plugin.syncState.activeSyncContext) {
          dump(`[SyncContext] Discard message ${msgAction} due to mismatched context. Expected: ${this.plugin.syncState.activeSyncContext}, Got: ${data.context}`);
          return;
        }
      }

      const handler = receiveOperators.get(msgAction);
      if (handler) {
        void handler(data.data, this.plugin);
        this.client.notifyActivity();
      }
    }
  }

  public sendClientInfo() {
    if (!this.client.isAuth) {
      return;
    }

    const clientName = this.plugin.getClientName();
    const isProtobufEnabled = this.plugin.settings.protobufEnabled !== false;

    if (!isProtobufEnabled) {
      // Reset client's Protobuf flag immediately to fallback to JSON format
      // 立即将客户端的 Protobuf 标志重置为 false 以退回到 JSON 格式
      this.client.useProtobuf = false;
    }

    this.Send(WSAction.ClientReceiveInfo, {
      name: clientName,
      version: this.plugin.manifest.version,
      type: CLIENT_TYPE,
      isDesktop: Platform.isDesktop,
      isMobile: Platform.isMobile,
      isPhone: Platform.isPhone,
      isTablet: Platform.isTablet,
      isMacOS: Platform.isMacOS,
      isWin: Platform.isWin,
      isLinux: Platform.isLinux,
      offlineSyncStrategy: this.plugin.settings.offlineSyncStrategy,
      protobuf: isProtobufEnabled,
    });
  }

  public async StartHandle() {
    const handleId = ++this.currentStartHandleId;
    dump(`Service start handle, id: ${handleId}`);

    if (this.plugin.settings.startupDelay > 0) {
      dump(`Startup delay: ${this.plugin.settings.startupDelay}ms`);
      await new Promise((resolve) => window.setTimeout(resolve, this.plugin.settings.startupDelay));
    }

    if (handleId !== this.currentStartHandleId) {
      dump(`Service start handle cancelled, id: ${handleId}`);
      return;
    }

    // 等待 fileHashManager 初始化完成
    if (!this.plugin.fileHashManager || !this.plugin.fileHashManager.isReady()) {
      dump(`Waiting for fileHashManager to be ready...`);

      // 最多等待 30 秒
      const maxWaitTime = 30000;
      const startTime = Date.now();

      while (!this.plugin.fileHashManager || !this.plugin.fileHashManager.isReady()) {
        if (Date.now() - startTime > maxWaitTime) {
          dump(`FileHashManager initialization timeout after ${maxWaitTime}ms`);
          showSyncNotice("文件哈希管理器初始化超时,同步可能不稳定");
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }

      if (this.plugin.fileHashManager && this.plugin.fileHashManager.isReady()) {
        dump("FileHashManager is ready, proceeding with sync");
      }
    }

    this.plugin.isFirstSync = true;
    this.plugin.isWatchEnabled = true;

    // 检查是否有用户手动触发的待执行同步 / Check if user manually triggered a pending sync
    const pendingType = this.plugin.syncState.pendingSyncType;
    this.plugin.syncState.pendingSyncType = null;

    if (this.plugin.settings.manualSyncEnabled) {
      // 如果用户手动触发了同步，即使 manualSyncEnabled 也执行一次
      // If user manually triggered sync, execute once even with manualSyncEnabled
      if (pendingType) {
        if (pendingType === 'full') {
          void startupFullSync(this.plugin);
        } else {
          void startupSync(this.plugin);
        }
      } else {
        dump("Full Manual Sync Mode enabled, skipping startup sync");
      }
      return;
    }

    // 有 pending 同步请求时，使用 pending 的类型；否则走默认增量同步
    // If pending sync requested, use its type; otherwise default incremental
    if (pendingType === 'full') {
      void startupFullSync(this.plugin);
    } else {
      void startupSync(this.plugin);
    }
  }

  private handleConflictError(data: StructuredMessageData) {
    const path = data.data?.Path;
    if (typeof path === "string") {
      dump("Conflict detected:", { code: data.code, Path: path, message: data.message });
      showSyncNotice($("ui.status.conflict", { path: path }), 10000);
    }
  }
}
