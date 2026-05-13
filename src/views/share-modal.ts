import { App, Modal, setIcon, ButtonComponent } from "obsidian";
import type FastSync from "../main";
import { $ } from "../i18n/lang";
import { showSyncNotice } from "../lib/helps";

export class ShareModal extends Modal {
    private plugin: FastSync;
    private path: string;
    private loading: boolean = false;
    private shareData: { id: number, token: string, isPassword?: boolean, shortLink?: string, baseUrl?: string } | null = null;
    
    // 密码状态相关
    private isPasswordVisible: boolean = false;
    private passwordValue: string = "";
    private isPasswordDirty: boolean = false;

    constructor(app: App, plugin: FastSync, path: string) {
        super(app);
        this.plugin = plugin;
        this.path = path;
    }

    onOpen() {
        this.checkShareStatus();
    }

    private async checkShareStatus() {
        this.loading = true;
        this.render();
        const res = await this.plugin.api.getShare(this.path);
        this.shareData = res;
        this.loading = false;
        this.isPasswordDirty = false;
        this.render();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("fns-share-modal");

        // 标题增加图标
        this.titleEl.empty();
        const titleIcon = this.titleEl.createSpan();
        titleIcon.addClass("fns-margin-r-8", "fns-inline-flex", "fns-flex-center-v");
        setIcon(titleIcon, "share-2");
        this.titleEl.createSpan({ text: $("ui.share.title") });

        const container = contentEl.createDiv("fns-share-container");
        container.addClass("fns-padding-10");

        const filePathEl = container.createDiv("fns-share-file-path");
        filePathEl.addClass("fns-margin-b-20", "fns-muted-text", "fns-font-09", "fns-break-all", "fns-bg-field", "fns-padding-10", "fns-radius-8");
        filePathEl.innerText = this.path;
 
        if (this.loading) {
            const loadingEl = container.createDiv("fns-share-loading");
            loadingEl.addClass("fns-text-center", "fns-padding-20", "fns-muted-text");
            loadingEl.innerText = $("ui.share.checking");
            return;
        }

        if (this.shareData) {
            this.renderShareResult(container);
        } else {
            this.renderCreateButton(container);
        }
    }

    private renderCreateButton(parent: HTMLElement) {
        const btnContainer = parent.createDiv("fns-share-btn-container");
        btnContainer.addClass("fns-text-center", "fns-padding-v-20");

        const btn = new ButtonComponent(btnContainer)
            .setButtonText(this.loading ? $("ui.share.button_creating") : $("ui.share.create"))
            .setCta()
            .setDisabled(this.loading)
            .onClick(async () => {
                this.loading = true;
                this.render();
                const res = await this.plugin.api.createShare(this.path);
                this.loading = false;
                if (res) {
                    this.shareData = res;
                    showSyncNotice($("ui.share.success"));
                    // 更新分享指示器缓存 / Update share indicator cache
                    this.plugin.shareIndicatorManager?.addSharedPath(this.path);
                }
                this.render();
            });
    }

    private renderShareResult(parent: HTMLElement) {
        const resultContainer = parent.createDiv("fns-share-result");
        
        // --- 1. 分享链接部分 ---
        const labelEl = resultContainer.createDiv("fns-share-label");
        labelEl.addClass("fns-margin-b-8", "fns-bold", "fns-flex", "fns-flex-center-v", "fns-gap-5", "fns-font-085", "fns-muted-text");
        const linkLabelIcon = labelEl.createSpan();
        setIcon(linkLabelIcon, "globe");
        labelEl.createSpan({ text: $("ui.share.link") });

        const apiBase = this.shareData?.baseUrl || (this.plugin.runApi || this.plugin.settings.api).replace(/\/+$/, "");
        const shareUrl = `${apiBase}/share/${this.shareData?.id}/${this.shareData?.token}`;

        const linkContainer = resultContainer.createDiv("fns-share-link-container");
        linkContainer.addClass("fns-flex", "fns-gap-10", "fns-margin-b-20");

        // 输入框包装容器
        const inputWrapper = linkContainer.createDiv();
        inputWrapper.addClass("fns-relative", "fns-flex-1");

        const inputEl = inputWrapper.createEl("input", {
            type: "text",
            value: shareUrl,
        });
        inputEl.addClass("fns-w-100", "fns-padding-r-35");
        inputEl.readOnly = true;

        // 内嵌复制按钮
        const copyBtn = new ButtonComponent(inputWrapper)
            .setIcon("copy")
            .setTooltip($("ui.share.copy"));
        
        copyBtn.buttonEl.addClass("fns-abs-center-v-right", "fns-no-shadow", "fns-no-border", "fns-bg-transparent", "fns-muted-text", "fns-flex", "fns-h-auto", "fns-padding-5", "fns-opacity-5");

        copyBtn.onClick(() => {
            navigator.clipboard.writeText(shareUrl);
            showSyncNotice($("ui.share.copy_success"));
        });

        // 查看分享按钮 (保持在外面)
        new ButtonComponent(linkContainer)
            .setIcon("external-link")
            .setTooltip($("ui.share.viewShare"))
            .onClick(() => {
                window.open(shareUrl, "_blank");
            });

        // --- 2. 密码管理部分 ---
        const passwordLabelEl = resultContainer.createDiv("fns-share-label");
        passwordLabelEl.addClass("fns-margin-b-8", "fns-bold", "fns-flex", "fns-flex-center-v", "fns-gap-5", "fns-font-085", "fns-muted-text");
        const pwdLabelIcon = passwordLabelEl.createSpan();
        setIcon(pwdLabelIcon, "lock");
        passwordLabelEl.createSpan({ text: $("ui.share.password") });

        const passwordContainer = resultContainer.createDiv("fns-share-password-container");
        passwordContainer.addClass("fns-flex", "fns-gap-10", "fns-margin-b-20");

        // 密码输入框包装容器
        const pwdInputWrapper = passwordContainer.createDiv();
        pwdInputWrapper.addClass("fns-relative", "fns-flex-1");

        // 如果已经有密码且用户还没修改，显示假密码
        let displayValue = this.passwordValue;
        if (this.shareData?.isPassword && !this.isPasswordVisible && !this.passwordValue) {
            displayValue = "******";
        }

        const pwdInputEl = pwdInputWrapper.createEl("input", {
            type: this.isPasswordVisible ? "text" : "password",
            value: displayValue,
            placeholder: $("ui.share.passwordPlaceholder")
        });
        pwdInputEl.addClass("fns-w-100", "fns-padding-r-35");

        // 眼睛按钮逻辑 (内嵌至容器最右侧，使用 ButtonComponent 确保与复制按钮尺寸一致)
        const eyeBtn = new ButtonComponent(pwdInputWrapper)
            .setIcon(this.isPasswordVisible ? "eye-off" : "eye")
            .onClick(() => {
                this.isPasswordVisible = !this.isPasswordVisible;
                if (this.isPasswordVisible && this.shareData?.isPassword && !this.passwordValue) {
                    this.passwordValue = "";
                }
                this.render();
            });
        
        eyeBtn.buttonEl.addClass("fns-abs-center-v-right", "fns-no-shadow", "fns-no-border", "fns-bg-transparent", "fns-muted-text", "fns-flex", "fns-h-auto", "fns-padding-5", "fns-opacity-5");

        pwdInputEl.addEventListener("input", (e) => {
            this.passwordValue = (e.target as HTMLInputElement).value;
            this.isPasswordDirty = true;
        });

        // 保存密码按钮
        new ButtonComponent(passwordContainer)
            .setIcon("check")
            .setTooltip($("ui.common.save"))
            .setDisabled(this.loading)
            .onClick(async () => {
                if (!this.isPasswordDirty) {
                    showSyncNotice($("ui.common.noChange"));
                    return;
                }
                this.loading = true;
                this.render();
                const success = await this.plugin.api.updateSharePassword(this.path, this.passwordValue);
                this.loading = false;
                if (success) {
                    showSyncNotice($("ui.common.saveSuccess"));
                    this.shareData!.isPassword = !!this.passwordValue;
                    this.isPasswordDirty = false;
                    if (this.passwordValue) {
                        this.passwordValue = "";
                        this.isPasswordVisible = false;
                    }
                }
                this.render();
            });

        // --- 3. 短链接部分 ---
        const shortLinkLabelEl = resultContainer.createDiv("fns-share-label");
        shortLinkLabelEl.addClass("fns-margin-b-8", "fns-bold", "fns-flex", "fns-flex-center-v", "fns-gap-5", "fns-font-085", "fns-muted-text");
        const shortLinkIcon = shortLinkLabelEl.createSpan();
        setIcon(shortLinkIcon, "link-2");
        shortLinkLabelEl.createSpan({ text: $("ui.share.shortLink") });

        const shortLinkContainer = resultContainer.createDiv("fns-share-short-link-container");
        shortLinkContainer.addClass("fns-flex", "fns-gap-10", "fns-margin-b-20");

        if (this.shareData?.shortLink) {
            // 短链接输入框包装容器
            const shortInputWrapper = shortLinkContainer.createDiv();
            shortInputWrapper.addClass("fns-relative", "fns-flex-1");

            const shortInputEl = shortInputWrapper.createEl("input", {
                type: "text",
                value: this.shareData.shortLink,
            });
            shortInputEl.addClass("fns-w-100", "fns-padding-r-35");
            shortInputEl.readOnly = true;

            // 内嵌复制按钮
            const shortCopyBtn = new ButtonComponent(shortInputWrapper)
                .setIcon("copy")
                .setTooltip($("ui.share.shortLinkCopy"));
            
            shortCopyBtn.buttonEl.addClass("fns-abs-center-v-right", "fns-no-shadow", "fns-no-border", "fns-bg-transparent", "fns-muted-text", "fns-flex", "fns-h-auto", "fns-padding-5", "fns-opacity-5");

            shortCopyBtn.onClick(() => {
                navigator.clipboard.writeText(this.shareData!.shortLink!);
                showSyncNotice($("ui.share.copy_success"));
            });
            
            // 刷新/重新生成按钮
            const refreshBtn = new ButtonComponent(shortLinkContainer)
                .setIcon("refresh-cw")
                .setTooltip($("ui.share.shortLinkCreate"))
                .setDisabled(this.loading);
            
            refreshBtn.onClick(async () => {
                refreshBtn.setDisabled(true);
                const newShortLink = await this.plugin.api.createShortLink(this.path, true, shareUrl);
                if (newShortLink) {
                    this.shareData!.shortLink = newShortLink;
                    this.render();
                }
                refreshBtn.setDisabled(false);
            });

        } else {
            const emptyInput = shortLinkContainer.createEl("input", {
                type: "text",
                placeholder: $("ui.share.shortLink"),
            });
            emptyInput.addClass("fns-flex-1");

            new ButtonComponent(shortLinkContainer)
                .setIcon("link-2")
                .setButtonText($("ui.share.shortLinkCreate"))
                .setDisabled(this.loading)
                .onClick(async () => {
                    this.loading = true;
                    this.render();
                    const shortLink = await this.plugin.api.createShortLink(this.path, false, shareUrl);
                    this.loading = false;
                    if (shortLink) {
                        this.shareData!.shortLink = shortLink;
                    }
                    this.render();
                });
        }

        // --- 4. 底部操作栏 (左右布局) ---
        const footerContainer = resultContainer.createDiv("fns-share-footer");
        footerContainer.addClass("fns-flex-between", "fns-margin-b-20", "fns-padding-v-20", "fns-share-footer");

        // 左侧：分享成功提示
        const tipEl = footerContainer.createDiv("fns-share-tip");
        tipEl.addClass("fns-font-085", "fns-accent-text", "fns-flex-center-v", "fns-gap-5");
        const iconSpan = tipEl.createSpan();
        iconSpan.addClass("fns-inline-flex", "fns-flex-center-v");
        setIcon(iconSpan, "check-circle-2");
        tipEl.createSpan({ text: $("ui.share.success") });

        // 右侧：取消分享按钮
        const cancelBtn = new ButtonComponent(footerContainer)
            .setCta()
            .setDisabled(this.loading);
        
        cancelBtn.buttonEl.addClass("fns-flex-center", "fns-gap-8");

        // 确保按钮内容为空后再手动构建，防止重复或冲突
        cancelBtn.buttonEl.empty();

        // 分别创建图标和文字的 span
        const cancelIconSpan = cancelBtn.buttonEl.createSpan();
        cancelIconSpan.addClass("fns-inline-flex", "fns-flex-center-v");
        setIcon(cancelIconSpan, "unlink"); 
        
        cancelBtn.buttonEl.createSpan({ text: $("ui.share.cancel") });

        cancelBtn.onClick(async () => {
            this.loading = true;
            this.render();
            const success = await this.plugin.api.cancelShare(this.path);
            this.loading = false;
            if (success) {
                this.shareData = null;
                this.passwordValue = "";
                this.isPasswordVisible = false;
                this.isPasswordDirty = false;
                showSyncNotice($("ui.share.cancel_success"));
                // 更新分享指示器缓存 / Update share indicator cache
                this.plugin.shareIndicatorManager?.removeSharedPath(this.path);
            }
            this.render();
        });
    }
}
