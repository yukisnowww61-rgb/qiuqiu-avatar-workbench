(() => {
    'use strict';

    const MODULE_ID = 'qiuqiu_avatar_workbench';
    const EXTENSION_FIELD = 'qiuqiu_avatar_workbench';
    const CHAT_METADATA_FIELD = 'qiuqiu_avatar_workbench';
    const DEFAULT_ICON_URL = 'https://imgbed.heliar.top/i/hWLZsEjJm7_lklfn_IMG_1048.gif';
    const DEFAULT_LAYOUT = Object.freeze({ x: 50, y: 50, zoom: 1 });
    const DEFAULT_ASPECT = Object.freeze({ w: 2, h: 3, label: '2:3' });
    const HISTORY_DB_NAME = 'qiuqiu_avatar_workbench';
    const HISTORY_DB_VERSION = 1;
    const HISTORY_STORE = 'avatarHistory';
    const HISTORY_LIMIT = 8;
    const CHAT_STORE_VERSION = 2;

    let context;
    let settings;
    let observer;
    let modal;
    let globalLauncherBound = false;
    let settingsLauncherAdded = false;
    let launcherPositionFrame = 0;
    let modalMoveState = null;
    let modalResizeState = null;
    const launcherMap = new Map();
    const historyObjectUrls = new Set();
    let historyDbPromise = null;
    let state = createInitialState();

    function createInitialState() {
        return {
            target: null,
            layout: { ...DEFAULT_LAYOUT },
            aspect: { ...DEFAULT_ASPECT },
            sourceKind: 'current',
            sourceUrl: '',
            file: null,
            loadedImage: null,
            objectUrl: '',
            dragging: false,
            dragStart: null,
            pointers: new Map(),
            pinchStart: null,
            replaceScope: 'permanent',
        };
    }

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const deepClone = (value) => JSON.parse(JSON.stringify(value));

    function notify(type, message) {
        const toast = globalThis.toastr;
        if (toast?.[type]) {
            toast[type](message, '丘丘头像工作台');
        } else {
            console[type === 'error' ? 'error' : 'log'](`[丘丘头像工作台] ${message}`);
        }
    }

    function getDefaults() {
        return {
            iconUrl: DEFAULT_ICON_URL,
            personaLayouts: {},
            characterLayouts: {},
            preferredAspect: '2:3',
            launcherGap: 2,
            replaceScope: 'permanent',
            modalRect: null,
        };
    }

    function ensureSettings() {
        const current = context.extensionSettings?.[MODULE_ID] ?? {};
        settings = Object.assign(getDefaults(), current);
        settings.personaLayouts ??= {};
        settings.characterLayouts ??= {};
        settings.launcherGap = clamp(Number(settings.launcherGap ?? 2), -24, 60);
        settings.replaceScope = settings.replaceScope === 'chat' ? 'chat' : 'permanent';
        context.extensionSettings[MODULE_ID] = settings;
    }

    function saveSettings() {
        context.saveSettingsDebounced?.();
    }

    function getIconUrl() {
        return settings.iconUrl?.trim() || DEFAULT_ICON_URL;
    }

    function setAllWorkbenchIcons(url) {
        document.querySelectorAll('.qqaw-name-button img, .qqaw-title-icon, #qqaw-settings-launcher img').forEach((img) => {
            img.src = url;
        });
    }

    function parseAvatarRef(src) {
        if (!src) return null;
        try {
            const url = new URL(src, location.origin);
            const pathname = decodeURIComponent(url.pathname);
            const thumbType = url.searchParams.get('type');
            const thumbFile = url.searchParams.get('file');

            if (pathname.endsWith('/thumbnail') && thumbFile) {
                return {
                    type: thumbType === 'persona' ? 'persona' : 'avatar',
                    file: thumbFile,
                };
            }

            const charMarker = '/characters/';
            const personaMarker = '/User Avatars/';
            if (pathname.includes(charMarker)) {
                return { type: 'avatar', file: pathname.split(charMarker).pop() };
            }
            if (pathname.includes(personaMarker)) {
                return { type: 'persona', file: pathname.split(personaMarker).pop() };
            }
        } catch (error) {
            console.debug('[丘丘头像工作台] 无法解析头像地址', error);
        }
        return null;
    }

    function getCharacterByAvatar(file) {
        if (!file) return null;
        const list = context.characters ?? [];
        const index = list.findIndex((char) => char?.avatar === file);
        if (index < 0) return null;
        return { character: list[index], charId: index };
    }

    function getTargetFromMessage(message) {
        if (!message) return null;
        const isUser = message.getAttribute('is_user') === 'true';
        const img = message.querySelector('.avatar img');
        const nameNode = message.querySelector('.name_text');
        const parsed = parseAvatarRef(img?.src);
        const displayName = nameNode?.textContent?.trim() || (isUser ? context.name1 : context.name2) || '';
        const originalKey = message.dataset.qqawOriginalKey || '';
        const originalKind = message.dataset.qqawOriginalKind || '';
        const originalCharId = message.dataset.qqawOriginalCharId;
        const tempOverride = parsed?.file?.startsWith('__qqaw_chat_')
            ? allChatOverrides().find((item) => item?.file === parsed.file && item.kind === (isUser ? 'user' : 'char'))
            : null;

        if (tempOverride) {
            if (isUser) {
                return {
                    kind: 'user',
                    key: tempOverride.targetKey || '',
                    name: tempOverride.targetName || displayName || 'USER',
                    sourceUrl: img?.src || '',
                    charId: null,
                    character: null,
                };
            }
            const tempCharId = tempOverride.charId != null && Number.isInteger(Number(tempOverride.charId)) ? Number(tempOverride.charId) : null;
            const tempCharacter = tempCharId != null ? context.characters?.[tempCharId] : getCharacterByAvatar(tempOverride.targetKey)?.character;
            return {
                kind: 'char',
                key: tempOverride.targetKey || tempCharacter?.avatar || '',
                name: tempOverride.targetName || tempCharacter?.name || tempCharacter?.data?.name || displayName || 'CHAR',
                sourceUrl: img?.src || '',
                charId: tempCharId,
                character: tempCharacter ?? null,
            };
        }

        if (originalKey && originalKind === (isUser ? 'user' : 'char')) {
            if (isUser) {
                return {
                    kind: 'user',
                    key: originalKey,
                    name: message.dataset.qqawOriginalName || displayName || 'USER',
                    sourceUrl: img?.src || '',
                    charId: null,
                    character: null,
                };
            }
            const charId = originalCharId !== '' && Number.isInteger(Number(originalCharId)) ? Number(originalCharId) : null;
            const character = charId != null ? context.characters?.[charId] : getCharacterByAvatar(originalKey)?.character;
            return {
                kind: 'char',
                key: originalKey,
                name: message.dataset.qqawOriginalName || character?.name || character?.data?.name || displayName || 'CHAR',
                sourceUrl: img?.src || '',
                charId,
                character: character ?? null,
            };
        }

        if (isUser) {
            const key = parsed?.type === 'persona' ? parsed.file : parsed?.file;
            return {
                kind: 'user',
                key: key || '',
                name: displayName || 'USER',
                sourceUrl: img?.src || '',
                charId: null,
                character: null,
            };
        }

        let match = parsed?.file ? getCharacterByAvatar(parsed.file) : null;
        if (!match && displayName) {
            const byName = (context.characters ?? []).findIndex((char) => (char?.name || char?.data?.name || '') === displayName);
            if (byName >= 0) match = { character: context.characters[byName], charId: byName };
        }
        if (!match && context.groupId == null && context.characterId != null && context.characterId !== '' && Number.isInteger(Number(context.characterId))) {
            const charId = Number(context.characterId);
            const character = context.characters?.[charId];
            if (character) match = { character, charId };
        }

        const resolvedCharKey = parsed?.type === 'avatar' && parsed?.file && !parsed.file.startsWith('__qqaw_chat_')
            ? parsed.file
            : (match?.character?.avatar || parsed?.file || '');
        return {
            kind: 'char',
            key: resolvedCharKey,
            name: match?.character?.name || match?.character?.data?.name || displayName || 'CHAR',
            sourceUrl: img?.src || '',
            charId: match?.charId ?? null,
            character: match?.character ?? null,
        };
    }

    function latestMessageTarget(kind) {
        const selector = kind === 'user'
            ? '#chat .mes[is_user="true"]:not(.template_element)'
            : '#chat .mes[is_user="false"]:not(.template_element)';
        const messages = [...document.querySelectorAll(selector)];
        for (let i = messages.length - 1; i >= 0; i--) {
            const target = getTargetFromMessage(messages[i]);
            if (target?.key || target?.character) return target;
        }
        return null;
    }

    function normalizeLayout(layout) {
        return {
            x: clamp(Number(layout?.x ?? 50), 0, 100),
            y: clamp(Number(layout?.y ?? 50), 0, 100),
            zoom: clamp(Number(layout?.zoom ?? 1), 1, 3),
        };
    }

    function supportsObjectViewBox() {
        return Boolean(globalThis.CSS?.supports?.('object-view-box', 'xywh(0px 0px 1px 1px)'));
    }

    function computeCropRect(naturalW, naturalH, targetRatio, layout) {
        const safeRatio = Number(targetRatio) > 0 ? Number(targetRatio) : 1;
        const normalized = normalizeLayout(layout);
        const sourceRatio = naturalW / naturalH;
        let baseW;
        let baseH;

        if (sourceRatio > safeRatio) {
            baseH = naturalH;
            baseW = naturalH * safeRatio;
        } else {
            baseW = naturalW;
            baseH = naturalW / safeRatio;
        }

        const width = baseW / normalized.zoom;
        const height = baseH / normalized.zoom;
        const left = (naturalW - width) * (normalized.x / 100);
        const top = (naturalH - height) * (normalized.y / 100);
        return { left, top, width, height };
    }

    function getCharacterLayoutFromCard(target) {
        const character = target?.character;
        const stored = character?.data?.extensions?.[EXTENSION_FIELD]?.layout;
        return stored ? normalizeLayout(stored) : null;
    }

    function getSavedLayout(target) {
        if (!target?.key) return { ...DEFAULT_LAYOUT };
        if (target.kind === 'user') {
            return normalizeLayout(settings.personaLayouts[target.key] ?? DEFAULT_LAYOUT);
        }
        return normalizeLayout(
            getCharacterLayoutFromCard(target)
            ?? settings.characterLayouts[target.key]
            ?? DEFAULT_LAYOUT,
        );
    }

    async function saveLayout(target, layout) {
        if (!target?.key) throw new Error('没有识别到头像文件。');
        const value = normalizeLayout(layout);

        if (target.kind === 'user') {
            settings.personaLayouts[target.key] = value;
            saveSettings();
            return;
        }

        settings.characterLayouts[target.key] = value;
        saveSettings();

        if (target.charId != null && typeof context.writeExtensionField === 'function') {
            try {
                await context.writeExtensionField(target.charId, EXTENSION_FIELD, { layout: value });
                const char = context.characters?.[target.charId];
                if (char) {
                    char.data ??= {};
                    char.data.extensions ??= {};
                    char.data.extensions[EXTENSION_FIELD] = { layout: value };
                    target.character = char;
                }
            } catch (error) {
                console.warn('[丘丘头像工作台] 写入 Character Card 扩展字段失败，已保留本地设置作为后备。', error);
            }
        }
    }

    function layoutForAvatarImage(img) {
        const message = img?.closest?.('.mes');
        if (message?.dataset?.qqawOriginalKey) {
            const target = getTargetFromMessage(message);
            if (target?.key) return getSavedLayout(target);
        }
        const parsed = parseAvatarRef(img?.src);
        if (!parsed?.file) return null;
        if (parsed.type === 'persona') {
            const layout = settings.personaLayouts[parsed.file];
            return layout ? normalizeLayout(layout) : null;
        }

        const match = getCharacterByAvatar(parsed.file);
        const cardLayout = match ? getCharacterLayoutFromCard({ character: match.character }) : null;
        const fallback = settings.characterLayouts[parsed.file];
        return cardLayout ?? (fallback ? normalizeLayout(fallback) : null);
    }

    function applyLayoutToImage(img, layout) {
        if (!img) return;
        if (!layout || (layout.x === 50 && layout.y === 50 && layout.zoom === 1)) {
            img.classList.remove('qqaw-framed-avatar');
            img.style.removeProperty('--qqaw-x');
            img.style.removeProperty('--qqaw-y');
            img.style.removeProperty('--qqaw-zoom');
            img.style.removeProperty('--qqaw-clip');
            img.style.removeProperty('object-view-box');
            return;
        }

        const normalized = normalizeLayout(layout);
        img.classList.add('qqaw-framed-avatar');
        img.style.setProperty('--qqaw-x', `${normalized.x}%`);
        img.style.setProperty('--qqaw-y', `${normalized.y}%`);
        img.style.setProperty('--qqaw-zoom', String(normalized.zoom));
        img.style.setProperty('--qqaw-clip', `${((1 - 1 / normalized.zoom) * 50).toFixed(4)}%`);

        const applyViewBox = () => {
            if (!supportsObjectViewBox() || !img.naturalWidth || !img.naturalHeight) return;
            const rect = img.getBoundingClientRect();
            const width = rect.width || img.clientWidth || img.parentElement?.clientWidth;
            const height = rect.height || img.clientHeight || img.parentElement?.clientHeight;
            if (!width || !height) return;
            const crop = computeCropRect(img.naturalWidth, img.naturalHeight, width / height, normalized);
            const value = `xywh(${crop.left.toFixed(3)}px ${crop.top.toFixed(3)}px ${crop.width.toFixed(3)}px ${crop.height.toFixed(3)}px)`;
            img.style.setProperty('object-view-box', value, 'important');
        };

        applyViewBox();
        if (!img.complete || !img.naturalWidth) {
            img.addEventListener('load', applyViewBox, { once: true });
        }
    }

    function refreshAllAvatarLayouts(root = document) {
        root.querySelectorAll?.('.avatar img').forEach((img) => {
            applyLayoutToImage(img, layoutForAvatarImage(img));
        });
    }

    function getNameAnchor(message) {
        if (!message?.isConnected) return null;
        const candidates = [
            message.querySelector('.name_text'),
            message.querySelector('.ch_name .name_text'),
            message.querySelector('.ch_name'),
        ].filter(Boolean);

        for (const element of candidates) {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
                return element;
            }
        }
        return null;
    }

    function getVisualTextRect(element) {
        if (!element) return null;
        try {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
            range.detach?.();
            if (!rects.length) return null;
            const left = Math.min(...rects.map((rect) => rect.left));
            const top = Math.min(...rects.map((rect) => rect.top));
            const right = Math.max(...rects.map((rect) => rect.right));
            const bottom = Math.max(...rects.map((rect) => rect.bottom));
            return { left, top, right, bottom, width: right - left, height: bottom - top };
        } catch (error) {
            console.debug('[丘丘头像工作台] 无法测量姓名文字范围，回退到元素范围。', error);
            return null;
        }
    }

    function getLauncherHost(_name, message) {
        if (!message) return null;
        // 入口直接挂在对应 .mes 上：这样滚动时它和该消息是同一个坐标系，
        // 不会像 position:fixed 那样留在屏幕上，也不会受姓名父容器 overflow 裁切。
        if (getComputedStyle(message).position === 'static') {
            message.classList.add('qqaw-launcher-host');
        }
        return message;
    }

    function removeLauncher(message, button) {
        button?.remove();
        launcherMap.delete(message);
        if (message?.dataset) delete message.dataset.qqawLauncherAttached;
    }

    function positionLauncher(message, button) {
        if (!message?.isConnected || !button?.isConnected) {
            removeLauncher(message, button);
            return;
        }

        const name = getNameAnchor(message);
        if (!name) {
            button.hidden = true;
            return;
        }

        const host = getLauncherHost(name, message);
        if (!host?.isConnected) {
            button.hidden = true;
            return;
        }
        if (button.parentElement !== host) host.append(button);
        button.__qqawHost = host;

        const nameRect = getVisualTextRect(name) || name.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const style = getComputedStyle(name);
        const fontSize = Number.parseFloat(style.fontSize) || 16;
        const measuredHeight = nameRect.height > 0 ? nameRect.height : fontSize;
        const size = clamp(measuredHeight, 8, 48);
        const gap = clamp(Number(settings.launcherGap ?? 2), -24, 60);

        // 这里使用“姓名坐标 - 宿主坐标”，得到宿主内部坐标。
        // 因为按钮是 absolute 且挂在消息内部，它会天然随着这条消息滚动，
        // 不再需要用 fixed 元素追踪滚动位置。
        const left = nameRect.right - hostRect.left + host.scrollLeft + gap;
        const top = nameRect.top - hostRect.top + host.scrollTop + (nameRect.height - size) / 2;

        button.hidden = false;
        button.style.setProperty('--qqaw-name-size', `${size}px`);
        button.style.setProperty('--qqaw-launcher-left', `${left}px`);
        button.style.setProperty('--qqaw-launcher-top', `${top}px`);
    }

    function updateLauncherPositions() {
        launcherPositionFrame = 0;
        for (const [message, button] of [...launcherMap.entries()]) {
            positionLauncher(message, button);
        }
    }

    function scheduleLauncherPositions() {
        if (launcherPositionFrame) return;
        launcherPositionFrame = requestAnimationFrame(updateLauncherPositions);
    }

    function createNameButton(message) {
        if (!message?.isConnected) return;
        const existing = launcherMap.get(message);
        if (existing?.isConnected) {
            scheduleLauncherPositions();
            return;
        }

        const name = getNameAnchor(message);
        if (!name) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qqaw-name-button';
        button.title = '打开丘丘头像工作台';
        button.setAttribute('aria-label', '打开丘丘头像工作台');
        button.dataset.qqawLauncher = '1';

        const img = document.createElement('img');
        img.src = getIconUrl();
        img.alt = '';
        button.append(img);

        button.__qqawMessage = message;
        const host = getLauncherHost(name, message);
        host.append(button);
        button.__qqawHost = host;
        launcherMap.set(message, button);
        message.dataset.qqawLauncherAttached = '1';
        scheduleLauncherPositions();

        // 某些美化会在消息渲染后再做一次布局，延迟校准几次。
        setTimeout(scheduleLauncherPositions, 50);
        setTimeout(scheduleLauncherPositions, 300);
        setTimeout(scheduleLauncherPositions, 1000);
    }

    function safeOpenWorkbenchFromMessage(message) {
        try {
            const target = getTargetFromMessage(message);
            if (!target) {
                notify('warning', '没有识别到这条消息对应的头像。');
                return;
            }
            openWorkbench(target);
        } catch (error) {
            console.error('[丘丘头像工作台] 打开工作台失败', error);
            notify('error', `打开工作台失败：${error?.message || error}`);
        }
    }

    function handleGlobalLauncherClick(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const button = path.find?.((node) => node instanceof Element && node.classList?.contains('qqaw-name-button'))
            || (event.target instanceof Element ? event.target.closest('.qqaw-name-button') : null);
        if (!button) return;

        // 在捕获阶段先处理，避免主题脚本 / 消息点击逻辑把事件吃掉。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        const message = button.__qqawMessage || button.closest('.mes');
        if (!message) {
            notify('warning', '没有找到这条消息，无法打开头像工作台。');
            return;
        }
        safeOpenWorkbenchFromMessage(message);
    }

    function bindGlobalLauncher() {
        if (globalLauncherBound) return;
        globalLauncherBound = true;
        window.addEventListener('click', handleGlobalLauncherClick, true);
        // 入口现在锚定在每条消息内部，不再跟随滚动重算；只在布局尺寸变化时重新定位。
        window.addEventListener('resize', scheduleLauncherPositions, { passive: true });
        window.addEventListener('orientationchange', scheduleLauncherPositions, { passive: true });
        globalThis.visualViewport?.addEventListener?.('resize', scheduleLauncherPositions, { passive: true });
    }

    function openFromSettingsLauncher() {
        try {
            const target = latestMessageTarget('char') || latestMessageTarget('user');
            if (!target) {
                notify('warning', '请先进入一个有聊天消息的对话，再打开丘丘头像工作台。');
                return;
            }
            openWorkbench(target);
        } catch (error) {
            console.error('[丘丘头像工作台] 设置页入口打开失败', error);
            notify('error', `打开工作台失败：${error?.message || error}`);
        }
    }

    function addSettingsLauncher() {
        if (settingsLauncherAdded || document.querySelector('#qqaw-settings-launcher')) return;
        const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
        if (!host) {
            setTimeout(addSettingsLauncher, 1200);
            return;
        }

        const wrap = document.createElement('div');
        wrap.id = 'qqaw-settings-launcher';
        wrap.className = 'qqaw-settings-launcher';
        wrap.innerHTML = `
            <div class="qqaw-settings-launcher-title">
                <img alt="" src="${getIconUrl().replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />
                <b>丘丘头像工作台</b>
            </div>
            <button type="button" class="menu_button" id="qqaw-settings-open">打开工作台</button>
            <small>如果聊天姓名后的图标被当前美化拦截，可以先从这里打开。</small>
        `;
        host.append(wrap);
        wrap.querySelector('#qqaw-settings-open')?.addEventListener('click', openFromSettingsLauncher);
        settingsLauncherAdded = true;
    }

    function scanMessages(root = document) {
        const messages = root.matches?.('.mes') ? [root] : [...root.querySelectorAll?.('#chat .mes, .mes') ?? []];
        messages.forEach((message) => {
            if (message.classList.contains('template_element') || message.id === 'message_template') return;
            createNameButton(message);
        });
        applyChatScopedOverrides(root);
        refreshAllAvatarLayouts(root);
        scheduleLauncherPositions();
    }

    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = 'qqaw-overlay';
        overlay.className = 'qqaw-hidden';
        overlay.innerHTML = `
            <section id="qqaw-modal" role="dialog" aria-modal="true" aria-labelledby="qqaw-title">
                <header class="qqaw-header" id="qqaw-drag-handle" title="拖动这里移动工作台">
                    <div class="qqaw-title-wrap">
                        <img class="qqaw-title-icon" alt="" />
                        <div>
                            <div id="qqaw-title">丘丘头像工作台</div>
                            <div id="qqaw-subtitle">快速更换 · 自由构图 · 历史回滚</div>
                        </div>
                    </div>
                    <div class="qqaw-window-actions">
                        <button type="button" id="qqaw-reset-window" class="qqaw-icon-button" aria-label="恢复窗口大小" title="恢复窗口大小和位置">↙</button>
                        <button type="button" id="qqaw-close" class="qqaw-icon-button" aria-label="关闭">×</button>
                    </div>
                </header>

                <div class="qqaw-body">
                    <div class="qqaw-target-row">
                        <button type="button" class="qqaw-target-button" data-kind="user">USER</button>
                        <button type="button" class="qqaw-target-button" data-kind="char">CHAR</button>
                        <div class="qqaw-target-info">
                            <span id="qqaw-target-name">—</span>
                            <span id="qqaw-target-file">—</span>
                        </div>
                    </div>

                    <div class="qqaw-main-grid">
                        <section class="qqaw-preview-panel">
                            <div id="qqaw-preview-shell" class="qqaw-preview-shell" style="--qqaw-aspect-w:2;--qqaw-aspect-h:3;">
                                <canvas id="qqaw-preview-canvas" aria-label="头像裁剪预览"></canvas>
                                <img id="qqaw-preview-img" alt="" draggable="false" hidden />
                                <div class="qqaw-preview-hint">拖动调整位置 · 滚轮/双指缩放</div>
                            </div>
                            <div class="qqaw-upload-row">
                                <button type="button" id="qqaw-pick-image" class="menu_button">选择新图片</button>
                                <input id="qqaw-file-input" type="file" accept="image/*" hidden />
                                <button type="button" id="qqaw-use-current" class="menu_button">重新载入当前头像</button>
                            </div>
                        </section>

                        <section class="qqaw-controls-panel">
                            <div class="qqaw-control-block">
                                <div class="qqaw-control-title">裁剪输出</div>
                                <div class="qqaw-fixed-ratio">2:3 · 512 × 768 · 只裁切，不拉伸原图</div>
                                <div id="qqaw-pan-note" class="qqaw-small-note"></div>
                            </div>

                            <label class="qqaw-slider-row">
                                <span>缩放 <output id="qqaw-zoom-value">1.00×</output></span>
                                <input id="qqaw-zoom" type="range" min="1" max="3" step="0.01" value="1" />
                            </label>
                            <label class="qqaw-slider-row">
                                <span>水平位置 <output id="qqaw-x-value">50%</output></span>
                                <input id="qqaw-x" type="range" min="0" max="100" step="0.1" value="50" />
                            </label>
                            <label class="qqaw-slider-row">
                                <span>垂直位置 <output id="qqaw-y-value">50%</output></span>
                                <input id="qqaw-y" type="range" min="0" max="100" step="0.1" value="50" />
                            </label>

                            <div class="qqaw-control-actions">
                                <button type="button" id="qqaw-reset-layout" class="menu_button">恢复居中</button>
                                <button type="button" id="qqaw-save-layout" class="menu_button qqaw-primary">保存显示范围</button>
                            </div>
                            <div class="qqaw-small-note">“保存显示范围”不会修改原图；它只保存当前头像的 X / Y / Zoom 构图。</div>

                            <div class="qqaw-divider"></div>

                            <div class="qqaw-control-title">替换范围</div>
                            <div class="qqaw-scope-row" role="group" aria-label="头像替换范围">
                                <button type="button" class="qqaw-scope-button" data-scope="chat">仅本次聊天</button>
                                <button type="button" class="qqaw-scope-button" data-scope="permanent">永久替换</button>
                            </div>
                            <div id="qqaw-scope-note" class="qqaw-small-note"></div>
                            <button type="button" id="qqaw-clear-chat-avatar" class="menu_button qqaw-clear-chat-avatar" hidden>取消本次聊天覆盖</button>

                            <button type="button" id="qqaw-replace-avatar" class="menu_button qqaw-dangerous">裁剪并替换头像</button>
                            <div class="qqaw-small-note">替换时固定输出 512×768（2:3）。图片只会被等比例裁切和缩放，不会横向或纵向拉伸。</div>
                        </section>
                    </div>

                    <section class="qqaw-history-card">
                        <div class="qqaw-section-head">
                            <div>
                                <div class="qqaw-section-kicker">AVATAR HISTORY</div>
                                <div class="qqaw-section-title">头像历史</div>
                            </div>
                            <button type="button" id="qqaw-clear-history" class="qqaw-text-button">清空</button>
                        </div>
                        <div id="qqaw-history-list" class="qqaw-history-list">
                            <div class="qqaw-history-empty">替换头像后，这里会自动保存最近记录。</div>
                        </div>
                    </section>

                    <details class="qqaw-icon-settings">
                        <summary>工作台与入口设置</summary>
                        <div class="qqaw-icon-settings-grid">
                            <label>
                                <span>图标 URL</span>
                                <input id="qqaw-icon-url" class="text_pole" type="url" placeholder="https://..." />
                            </label>
                            <div class="qqaw-icon-buttons">
                                <button type="button" id="qqaw-apply-icon" class="menu_button">应用 URL</button>
                                <button type="button" id="qqaw-pick-icon" class="menu_button">上传本地图标</button>
                                <input id="qqaw-icon-file" type="file" accept="image/*,.gif" hidden />
                                <button type="button" id="qqaw-reset-icon" class="menu_button">恢复默认</button>
                            </div>
                            <label class="qqaw-slider-row qqaw-gap-control">
                                <span>图标到姓名距离 <output id="qqaw-gap-value">2 px</output></span>
                                <input id="qqaw-launcher-gap" type="range" min="-24" max="60" step="1" value="2" />
                            </label>
                            <div class="qqaw-small-note">支持 PNG / JPG / WebP / GIF。负数会让图标更贴近姓名；入口固定在每条消息内部，会随该消息一起滚动。</div>
                        </div>
                    </details>
                </div>
                <div class="qqaw-resize-handle qqaw-resize-n" data-dir="n"></div>
                <div class="qqaw-resize-handle qqaw-resize-e" data-dir="e"></div>
                <div class="qqaw-resize-handle qqaw-resize-s" data-dir="s"></div>
                <div class="qqaw-resize-handle qqaw-resize-w" data-dir="w"></div>
                <div class="qqaw-resize-handle qqaw-resize-ne" data-dir="ne"></div>
                <div class="qqaw-resize-handle qqaw-resize-se" data-dir="se"></div>
                <div class="qqaw-resize-handle qqaw-resize-sw" data-dir="sw"></div>
                <div class="qqaw-resize-handle qqaw-resize-nw" data-dir="nw"></div>
            </section>
        `;
        document.body.append(overlay);
        modal = overlay;
        overlay.querySelector('.qqaw-title-icon').src = getIconUrl();
        bindModalEvents();
    }

    function bindModalEvents() {
        const $ = (selector) => modal.querySelector(selector);
        $('#qqaw-close').addEventListener('click', closeWorkbench);
        $('#qqaw-reset-window').addEventListener('click', resetModalWindow);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeWorkbench();
        });

        const dragHandle = $('#qqaw-drag-handle');
        dragHandle.addEventListener('pointerdown', beginModalMove);
        dragHandle.addEventListener('pointermove', moveModal);
        dragHandle.addEventListener('pointerup', endModalMove);
        dragHandle.addEventListener('pointercancel', endModalMove);
        modal.querySelectorAll('.qqaw-resize-handle').forEach((handle) => {
            handle.addEventListener('pointerdown', beginModalResize);
            handle.addEventListener('pointermove', resizeModal);
            handle.addEventListener('pointerup', endModalResize);
            handle.addEventListener('pointercancel', endModalResize);
        });

        modal.querySelectorAll('.qqaw-target-button').forEach((button) => {
            button.addEventListener('click', () => switchTarget(button.dataset.kind));
        });

        $('#qqaw-pick-image').addEventListener('click', () => $('#qqaw-file-input').click());
        $('#qqaw-file-input').addEventListener('change', onAvatarFilePicked);
        $('#qqaw-use-current').addEventListener('click', () => loadTargetImage(true));

        $('#qqaw-zoom').addEventListener('input', () => {
            state.layout.zoom = Number($('#qqaw-zoom').value);
            updatePreview();
        });
        $('#qqaw-x').addEventListener('input', () => {
            state.layout.x = Number($('#qqaw-x').value);
            updatePreview();
        });
        $('#qqaw-y').addEventListener('input', () => {
            state.layout.y = Number($('#qqaw-y').value);
            updatePreview();
        });

        $('#qqaw-reset-layout').addEventListener('click', () => {
            state.layout = { ...DEFAULT_LAYOUT };
            updatePreview();
        });
        $('#qqaw-save-layout').addEventListener('click', saveCurrentDisplayLayout);
        $('#qqaw-replace-avatar').addEventListener('click', replaceAvatar);
        $('#qqaw-clear-chat-avatar').addEventListener('click', removeCurrentChatOverride);
        modal.querySelectorAll('.qqaw-scope-button').forEach((button) => {
            button.addEventListener('click', () => {
                const requested = button.dataset.scope === 'chat' ? 'chat' : 'permanent';
                if (state.target?.kind === 'char' && requested === 'chat') return;
                state.replaceScope = requested;
                // 替换范围偏好只用于 USER；CHAR 永远固定为永久替换。
                if (state.target?.kind === 'user') {
                    settings.replaceScope = state.replaceScope;
                    saveSettings();
                }
                syncTargetUi();
                syncReplaceScopeUi();
            });
        });

        const shell = $('#qqaw-preview-shell');
        shell.addEventListener('pointerdown', beginDrag);
        shell.addEventListener('pointermove', dragPreview);
        shell.addEventListener('pointerup', endDrag);
        shell.addEventListener('pointercancel', endDrag);
        shell.addEventListener('wheel', onPreviewWheel, { passive: false });

        $('#qqaw-apply-icon').addEventListener('click', applyIconUrl);
        $('#qqaw-pick-icon').addEventListener('click', () => $('#qqaw-icon-file').click());
        $('#qqaw-icon-file').addEventListener('change', applyLocalIcon);
        $('#qqaw-reset-icon').addEventListener('click', resetWorkbenchIcon);
        $('#qqaw-clear-history').addEventListener('click', clearCurrentHistory);
        $('#qqaw-history-list').addEventListener('click', handleHistoryClick);
        $('#qqaw-launcher-gap').addEventListener('input', () => {
            settings.launcherGap = clamp(Number($('#qqaw-launcher-gap').value), -24, 60);
            $('#qqaw-gap-value').value = `${settings.launcherGap} px`;
            saveSettings();
            updateLauncherPositions();
        });
    }

    function getModalPanel() {
        return modal?.querySelector('#qqaw-modal') ?? null;
    }

    function clampModalRect(rect) {
        const viewportW = Math.max(300, globalThis.visualViewport?.width || window.innerWidth || 800);
        const viewportH = Math.max(360, globalThis.visualViewport?.height || window.innerHeight || 700);
        const minW = Math.min(280, viewportW - 8);
        const minH = Math.min(320, viewportH - 8);
        const maxW = Math.max(minW, viewportW - 8);
        const maxH = Math.max(minH, viewportH - 8);
        const width = clamp(Number(rect?.width || Math.min(820, viewportW - 24)), minW, maxW);
        const height = clamp(Number(rect?.height || Math.min(760, viewportH - 24)), minH, maxH);
        const left = clamp(Number(rect?.left ?? (viewportW - width) / 2), 4, Math.max(4, viewportW - width - 4));
        const top = clamp(Number(rect?.top ?? (viewportH - height) / 2), 4, Math.max(4, viewportH - height - 4));
        return { left, top, width, height };
    }

    function applyModalRect(rect, persist = false) {
        const panel = getModalPanel();
        if (!panel) return;
        const safe = clampModalRect(rect);
        panel.style.left = `${safe.left}px`;
        panel.style.top = `${safe.top}px`;
        panel.style.width = `${safe.width}px`;
        panel.style.height = `${safe.height}px`;
        if (persist) {
            settings.modalRect = safe;
            saveSettings();
        }
    }

    function resetModalWindow() {
        settings.modalRect = null;
        saveSettings();
        applyModalRect(null, false);
    }

    function persistCurrentModalRect() {
        const panel = getModalPanel();
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        applyModalRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, true);
    }

    function beginModalMove(event) {
        if (event.button != null && event.button !== 0) return;
        if (event.target.closest('button, input, select, textarea, a, summary')) return;
        const panel = getModalPanel();
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        modalMoveState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    function moveModal(event) {
        if (!modalMoveState || event.pointerId !== modalMoveState.pointerId) return;
        const next = {
            left: modalMoveState.left + (event.clientX - modalMoveState.startX),
            top: modalMoveState.top + (event.clientY - modalMoveState.startY),
            width: modalMoveState.width,
            height: modalMoveState.height,
        };
        applyModalRect(next, false);
    }

    function endModalMove(event) {
        if (!modalMoveState || event.pointerId !== modalMoveState.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        modalMoveState = null;
        persistCurrentModalRect();
    }

    function beginModalResize(event) {
        if (event.button != null && event.button !== 0) return;
        const panel = getModalPanel();
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        modalResizeState = {
            pointerId: event.pointerId,
            dir: event.currentTarget.dataset.dir || 'se',
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    }

    function resizeModal(event) {
        if (!modalResizeState || event.pointerId !== modalResizeState.pointerId) return;
        const state0 = modalResizeState;
        const dx = event.clientX - state0.startX;
        const dy = event.clientY - state0.startY;
        let left = state0.left;
        let top = state0.top;
        let width = state0.width;
        let height = state0.height;
        if (state0.dir.includes('e')) width += dx;
        if (state0.dir.includes('s')) height += dy;
        if (state0.dir.includes('w')) {
            left += dx;
            width -= dx;
        }
        if (state0.dir.includes('n')) {
            top += dy;
            height -= dy;
        }
        applyModalRect({ left, top, width, height }, false);
    }

    function endModalResize(event) {
        if (!modalResizeState || event.pointerId !== modalResizeState.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        modalResizeState = null;
        persistCurrentModalRect();
    }

    function syncReplaceScopeUi() {
        if (!modal) return;
        const isChar = state.target?.kind === 'char';
        if (isChar) state.replaceScope = 'permanent';

        modal.querySelectorAll('.qqaw-scope-button').forEach((button) => {
            const isChatButton = button.dataset.scope === 'chat';
            // CHAR 不支持“仅本次聊天”，直接隐藏这个选项；USER 保持两种模式不变。
            button.hidden = isChar && isChatButton;
            button.classList.toggle('active', button.dataset.scope === state.replaceScope);
        });

        const note = modal.querySelector('#qqaw-scope-note');
        const replace = modal.querySelector('#qqaw-replace-avatar');
        if (isChar) {
            note.textContent = 'CHAR 头像仅支持永久替换；新头像会写入 Character，并用于该角色的其他聊天。';
            replace.textContent = '裁剪并替换 · 永久';
        } else if (state.replaceScope === 'chat') {
            note.textContent = '只覆盖当前聊天中的 USER 头像，不修改 Persona 本体；切换到别的聊天仍使用原头像。';
            replace.textContent = '裁剪并替换 · 仅本次聊天';
        } else {
            note.textContent = '直接修改 Persona 的头像文件，其他聊天也会使用新头像。';
            replace.textContent = '裁剪并替换 · 永久';
        }

        const clearButton = modal.querySelector('#qqaw-clear-chat-avatar');
        if (clearButton) clearButton.hidden = isChar || !getChatOverrideForTarget(state.target);
    }

    async function removeCurrentChatOverride() {
        if (!state.target) return;
        try {
            const target = { ...state.target };
            await clearChatOverride(target);
            await syncCurrentChatToPermanentPersona(target);
            const fresh = withCacheBust(directAvatarUrl(target));
            document.querySelectorAll('#chat .mes:not(.template_element)').forEach((message) => {
                const candidate = getTargetFromMessage(message);
                const same = candidate?.kind === target.kind && (
                    (candidate.key && target.key && candidate.key === target.key)
                    || (candidate.name && target.name && candidate.name === target.name)
                    || (target.kind === 'char' && candidate.charId != null && target.charId != null && candidate.charId === target.charId)
                );
                if (!same) return;
                delete message.dataset.qqawOriginalKind;
                delete message.dataset.qqawOriginalKey;
                delete message.dataset.qqawOriginalName;
                delete message.dataset.qqawOriginalCharId;
                message.querySelectorAll('.avatar img').forEach((img) => setFreshImageSource(img, fresh));
            });
            state.target.sourceUrl = fresh;
            await forceCurrentChatAvatarRefresh(target);
            await loadTargetImage(true);
            refreshAllAvatarLayouts(document);
            syncReplaceScopeUi();
            notify('success', '已取消当前聊天的临时头像，恢复为永久头像。');
        } catch (error) {
            console.error('[丘丘头像工作台] 取消本次聊天覆盖失败', error);
            notify('error', error.message || '取消本次聊天覆盖失败。');
        }
    }

    function openWorkbench(target) {
        if (!modal) buildModal();
        state.target = target;
        state.layout = getSavedLayout(target);
        state.file = null;
        state.sourceKind = 'current';
        state.aspect = { ...DEFAULT_ASPECT };
        state.replaceScope = target?.kind === 'char'
            ? 'permanent'
            : (settings.replaceScope === 'chat' ? 'chat' : 'permanent');
        modal.classList.remove('qqaw-hidden');
        document.body.classList.add('qqaw-modal-open');
        requestAnimationFrame(() => applyModalRect(settings.modalRect, false));
        modal.querySelector('#qqaw-icon-url').value = settings.iconUrl || DEFAULT_ICON_URL;
        modal.querySelector('#qqaw-launcher-gap').value = settings.launcherGap ?? 2;
        modal.querySelector('#qqaw-gap-value').value = `${settings.launcherGap ?? 2} px`;
        syncTargetUi();
        syncReplaceScopeUi();
        const shell = modal.querySelector('#qqaw-preview-shell');
        shell.style.setProperty('--qqaw-aspect-w', 2);
        shell.style.setProperty('--qqaw-aspect-h', 3);
        updatePreview();
        loadTargetImage(true);
        renderHistory();
    }

    function closeWorkbench() {
        if (!modal) return;
        modal.classList.add('qqaw-hidden');
        document.body.classList.remove('qqaw-modal-open');
        revokeObjectUrl();
        state.file = null;
        state.loadedImage = null;
        state.pointers.clear();
        state.pinchStart = null;
        state.dragging = false;
        revokeHistoryObjectUrls();
    }

    function syncTargetUi() {
        const target = state.target;
        modal.querySelector('#qqaw-target-name').textContent = target?.name || '未识别';
        modal.querySelector('#qqaw-target-file').textContent = target?.key || '未识别头像文件';
        modal.querySelectorAll('.qqaw-target-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.kind === target?.kind);
        });
        const replaceButton = modal.querySelector('#qqaw-replace-avatar');
        const canReplace = Boolean(target?.key) && (state.replaceScope === 'chat' || target.kind === 'user' || target.charId != null);
        replaceButton.disabled = !canReplace;
        replaceButton.title = canReplace ? '' : '永久替换需要识别到可编辑的 Character / Persona。';
    }

    function switchTarget(kind) {
        const target = latestMessageTarget(kind);
        if (!target) {
            notify('warning', kind === 'user' ? '当前聊天里没有找到可识别的 USER Persona 头像。' : '当前聊天里没有找到可识别的 CHAR 头像。');
            return;
        }
        revokeObjectUrl();
        state.target = target;
        state.layout = getSavedLayout(target);
        state.file = null;
        state.sourceKind = 'current';
        state.replaceScope = target.kind === 'char'
            ? 'permanent'
            : (settings.replaceScope === 'chat' ? 'chat' : 'permanent');
        syncTargetUi();
        syncReplaceScopeUi();
        updatePreview();
        loadTargetImage(true);
        renderHistory();
    }

    function withCacheBust(url) {
        if (!url) return '';
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}qqaw=${Date.now()}`;
    }

    function liveContext() {
        return globalThis.SillyTavern?.getContext?.() ?? context;
    }

    function hashString(value) {
        let hash = 2166136261;
        const text = String(value ?? '');
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function getCurrentChatIdentity() {
        const ctx = liveContext();
        return String(ctx.getCurrentChatId?.() || ctx.chatId || ctx.chatMetadata?.integrity || 'chat');
    }

    function overrideKeyForTarget(target) {
        if (!target) return '';
        const stable = target.kind === 'char'
            ? (target.character?.avatar || target.key || target.name)
            : (target.key || target.name);
        return `${target.kind}:${stable}`;
    }

    function getChatOverrideStore(create = false) {
        const ctx = liveContext();
        const metadata = ctx.chatMetadata;
        if (!metadata) return null;
        if (!metadata[CHAT_METADATA_FIELD] && create) metadata[CHAT_METADATA_FIELD] = { version: CHAT_STORE_VERSION, overrides: {} };
        const store = metadata[CHAT_METADATA_FIELD];
        if (store && !store.overrides && create) store.overrides = {};
        if (store && create) store.version = CHAT_STORE_VERSION;
        return store || null;
    }

    function allChatOverrides() {
        return Object.values(getChatOverrideStore(false)?.overrides ?? {});
    }

    function getChatOverrideForTarget(target) {
        if (!target) return null;
        const overrides = getChatOverrideStore(false)?.overrides ?? {};
        const exact = overrides[overrideKeyForTarget(target)];
        if (exact) return exact;
        return Object.values(overrides).find((item) => {
            if (!item || item.kind !== target.kind) return false;
            if (item.targetKey && target.key && item.targetKey === target.key) return true;
            if (target.kind === 'char' && item.charId != null && target.charId != null && Number(item.charId) === Number(target.charId)) return true;
            return Boolean(item.targetName && target.name && item.targetName === target.name);
        }) || null;
    }

    function chatOverrideUrl(override) {
        if (!override?.file) return '';
        const base = `/User%20Avatars/${encodeURIComponent(override.file)}`;
        return `${base}?qqawchat=${encodeURIComponent(override.createdAt || Date.now())}`;
    }

    function chatMessageMatchesUserTarget(message, target) {
        if (!message?.is_user || target?.kind !== 'user') return false;
        const original = String(message.original_avatar || '');
        if (target.key && original === target.key) return true;

        const parsedForce = parseAvatarRef(message.force_avatar || '');
        if (target.key && parsedForce?.file === target.key) return true;

        // 临时头像写入后 force_avatar 会指向 __qqaw_chat_*，
        // 此时 original_avatar 是回到原 Persona 的稳定锚点。
        if (parsedForce?.file?.startsWith('__qqaw_chat_') && target.key && original === target.key) return true;

        return Boolean(target.name && message.name && String(message.name).trim() === String(target.name).trim());
    }

    async function saveCurrentChatNow() {
        const ctx = liveContext();
        if (typeof ctx.saveChat === 'function') {
            await ctx.saveChat();
            return;
        }
        await persistChatMetadata({ flush: true });
    }

    async function syncUserMessagesToAvatar(target, avatarUrl) {
        if (target?.kind !== 'user' || !avatarUrl) return 0;
        const ctx = liveContext();
        const messages = Array.isArray(ctx.chat) ? ctx.chat : [];
        let changed = 0;

        for (const message of messages) {
            if (!chatMessageMatchesUserTarget(message, target)) continue;
            message.original_avatar = target.key || message.original_avatar || '';
            if (message.force_avatar !== avatarUrl) {
                message.force_avatar = avatarUrl;
                changed += 1;
            }
        }

        if (changed) await saveCurrentChatNow();
        return changed;
    }

    async function syncCurrentChatToPermanentPersona(target) {
        if (target?.kind !== 'user') return;
        const fresh = withCacheBust(directAvatarUrl(target));
        await syncUserMessagesToAvatar(target, fresh);
    }

    async function migrateLegacyChatOverrideStore() {
        const store = getChatOverrideStore(false);
        if (!store) return false;
        const version = Number(store.version || 1);
        if (version >= CHAT_STORE_VERSION) return false;

        const hadLegacyOverride = Object.keys(store.overrides || {}).length > 0;
        // v0.1.4-v0.1.8 只在 DOM 层强压头像，容易留下“旧临时头像锁死”的状态。
        // v2 改为写入 SillyTavern 自己的 message.force_avatar，因此旧活动覆盖不迁移，
        // 首次升级主动清空一次，让当前聊天先恢复 Persona 的真实状态。
        store.version = CHAT_STORE_VERSION;
        store.overrides = {};
        await persistChatMetadata({ flush: true });
        return hadLegacyOverride;
    }

    async function persistChatMetadata({ flush = false } = {}) {
        const ctx = liveContext();

        // 新版 ST / 部分宿主会暴露真正可 await 的 saveMetadata。优先用它，
        // 这样在 reloadCurrentChat 之前可以确保聊天 metadata 已经落盘。
        if (typeof ctx.saveMetadata === 'function') {
            await ctx.saveMetadata();
            return;
        }

        // saveMetadataDebounced() 只是安排稍后的保存，本身通常返回 void。
        // 如果后面马上要 reloadCurrentChat，就必须等过 debounce 窗口，
        // 否则 reload 会把磁盘中的旧 metadata 再读回来。
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
            if (flush) {
                await new Promise((resolve) => setTimeout(resolve, 1150));
            }
            return;
        }

        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    }

    async function setChatOverride(target, file) {
        if (target?.kind !== 'user') throw new Error('CHAR 头像不支持“仅本次聊天”替换。');
        const store = getChatOverrideStore(true);
        if (!store) throw new Error('当前聊天 metadata 不可用，无法保存“仅本次聊天”头像。');
        const key = overrideKeyForTarget(target);
        const record = {
            kind: target.kind,
            targetKey: target.key || '',
            targetName: target.name || '',
            charId: target.charId,
            file,
            createdAt: Date.now(),
        };
        store.overrides[key] = record;
        await persistChatMetadata({ flush: true });
        return record;
    }

    async function clearChatOverride(target) {
        const store = getChatOverrideStore(false);
        if (!store?.overrides) return;
        let changed = false;
        for (const [key, item] of Object.entries(store.overrides)) {
            if (!item || item.kind !== target.kind) continue;
            const matches = key === overrideKeyForTarget(target)
                || (item.targetKey && target.key && item.targetKey === target.key)
                || (target.kind === 'char' && item.charId != null && target.charId != null && Number(item.charId) === Number(target.charId))
                || (item.targetName && target.name && item.targetName === target.name);
            if (matches) {
                delete store.overrides[key];
                changed = true;
            }
        }
        if (changed) await persistChatMetadata({ flush: true });
    }

    function findChatOverrideForMessage(message) {
        if (!message) return null;
        const isUser = message.getAttribute('is_user') === 'true';
        // 聊天级头像只支持 USER，忽略旧版本可能遗留的 CHAR 临时覆盖。
        if (!isUser) return null;
        const kind = 'user';
        const name = message.querySelector('.name_text')?.textContent?.trim() || '';
        const parsed = parseAvatarRef(message.querySelector('.avatar img')?.src);
        const overrides = allChatOverrides();
        return overrides.find((item) => {
            if (!item || item.kind !== kind) return false;
            if (message.dataset.qqawOriginalKey && item.targetKey === message.dataset.qqawOriginalKey) return true;
            if (parsed?.file && !parsed.file.startsWith('__qqaw_chat_')) {
                return Boolean(item.targetKey && parsed.file === item.targetKey);
            }
            return Boolean(item.targetName && name && item.targetName === name);
        }) || null;
    }

    function imageUsesChatOverride(img, override) {
        if (!img || !override?.file) return false;
        const parsed = parseAvatarRef(img.currentSrc || img.src);
        const picture = img.closest?.('picture');
        const hasResponsiveSource = Boolean(img.getAttribute('srcset') || picture?.querySelector?.('source[srcset]'));
        return parsed?.file === override.file && !hasResponsiveSource;
    }

    function applyChatOverrideToMessage(message) {
        const override = findChatOverrideForMessage(message);
        if (!override) return false;
        message.dataset.qqawOriginalKind = override.kind;
        message.dataset.qqawOriginalKey = override.targetKey || '';
        message.dataset.qqawOriginalName = override.targetName || '';
        message.dataset.qqawOriginalCharId = override.charId == null ? '' : String(override.charId);
        const fresh = chatOverrideUrl(override);
        message.querySelectorAll('.avatar img').forEach((img) => {
            // SillyTavern / 某些主题会在消息完成渲染后再次写回 Persona 永久头像。
            // 只有当当前实际显示源不是聊天级头像（或又出现 srcset）时才重写，
            // 这样既能持续守住临时头像，也不会和 MutationObserver 自己形成死循环。
            if (!imageUsesChatOverride(img, override)) setFreshImageSource(img, fresh);
        });
        return true;
    }

    function applyChatScopedOverrides(root = document) {
        const messages = root.matches?.('.mes') ? [root] : [...root.querySelectorAll?.('#chat .mes, .mes') ?? []];
        messages.forEach((message) => {
            if (message.classList.contains('template_element') || message.id === 'message_template') return;
            applyChatOverrideToMessage(message);
        });
    }

    function scheduleChatOverrideReapply() {
        // CHAT_CHANGED / Persona 刷新后，ST 的消息头像可能分多轮完成渲染。
        // 多个短延迟 + 属性观察器共同保证最后一轮写回也会被纠正。
        const run = () => {
            applyChatScopedOverrides(document);
            refreshAllAvatarLayouts(document);
        };
        requestAnimationFrame(run);
        [40, 120, 300, 700, 1400].forEach((delay) => setTimeout(run, delay));
    }

    function refreshChatScopedOverride(target) {
        const override = getChatOverrideForTarget(target);
        if (!override) return;
        document.querySelectorAll('#chat .mes:not(.template_element)').forEach((message) => {
            const candidate = getTargetFromMessage(message);
            const same = candidate?.kind === target.kind && (
                (candidate.key && target.key && candidate.key === target.key)
                || (candidate.name && target.name && candidate.name === target.name)
                || (target.kind === 'char' && candidate.charId != null && target.charId != null && candidate.charId === target.charId)
            );
            if (same) applyChatOverrideToMessage(message);
        });
    }

    function avatarUploadFile(blob, baseName = 'qiuqiu-avatar') {
        const type = blob?.type || 'image/png';
        const ext = type.includes('webp') ? 'webp'
            : type.includes('gif') ? 'gif'
                : type.includes('jpeg') || type.includes('jpg') ? 'jpg'
                    : type.includes('avif') ? 'avif'
                        : 'png';
        return new File([blob], `${baseName}.${ext}`, { type });
    }

    function avatarExtension(blob) {
        const type = blob?.type || '';
        if (type.includes('webp')) return 'webp';
        if (type.includes('gif')) return 'gif';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        if (type.includes('avif')) return 'avif';
        return 'png';
    }

    async function uploadChatScopedAvatar(target, blob) {
        if (target?.kind !== 'user') throw new Error('CHAR 头像不支持“仅本次聊天”替换。');
        const chatIdentity = getCurrentChatIdentity();
        const suffix = hashString(`${target.kind}|${target.key}|${target.name}`);

        // 每一次聊天级替换都使用全新的文件名。
        // 不能继续覆盖同一个 __qqaw_chat_ 文件，否则 WebView / 图片缓存层可能
        // 在第二次替换后仍然返回第一次的内容，即使 query string 已变化。
        const revision = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const file = `__qqaw_chat_${hashString(chatIdentity)}_${suffix}_${revision}.${avatarExtension(blob)}`;
        const formData = new FormData();
        formData.append('avatar', avatarUploadFile(blob, 'qiuqiu-chat-avatar'));
        formData.append('overwrite_name', file);
        const response = await fetch('/api/avatars/upload', {
            method: 'POST',
            headers: liveContext().getRequestHeaders?.({ omitContentType: true }) ?? {},
            body: formData,
            cache: 'no-cache',
        });
        if (!response.ok) throw new Error(`本次聊天头像上传失败（HTTP ${response.status}）。`);

        // 先写入聊天 metadata，并等它真正落盘，再允许后续 reloadCurrentChat。
        const record = await setChatOverride(target, file);
        // 关键：不再只改 <img src>。SillyTavern 渲染 USER 消息时会优先读取
        // message.force_avatar；把临时头像写到消息数据层，重进聊天也不会被永久头像抢回去。
        await syncUserMessagesToAvatar(target, chatOverrideUrl(record));
        refreshChatScopedOverride(target);
        setTimeout(() => refreshChatScopedOverride(target), 80);
        setTimeout(() => refreshChatScopedOverride(target), 300);
        return record;
    }

    function openHistoryDb() {
        if (historyDbPromise) return historyDbPromise;
        historyDbPromise = new Promise((resolve, reject) => {
            if (!globalThis.indexedDB) {
                reject(new Error('当前 WebView 不支持 IndexedDB。'));
                return;
            }
            const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                    const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('头像历史数据库打开失败。'));
        });
        return historyDbPromise;
    }

    async function historyGetAll() {
        const db = await openHistoryDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HISTORY_STORE, 'readonly');
            const req = tx.objectStore(HISTORY_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error || new Error('读取头像历史失败。'));
        });
    }

    async function historyPut(record) {
        const db = await openHistoryDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            tx.objectStore(HISTORY_STORE).put(record);
            tx.oncomplete = () => resolve(record);
            tx.onerror = () => reject(tx.error || new Error('保存头像历史失败。'));
        });
    }

    async function historyDelete(id) {
        const db = await openHistoryDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            tx.objectStore(HISTORY_STORE).delete(id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('删除头像历史失败。'));
        });
    }

    function historyTargetMatches(record, target) {
        if (!record || !target || record.kind !== target.kind) return false;
        if (target.kind === 'char' && record.charId != null && target.charId != null) {
            return Number(record.charId) === Number(target.charId);
        }
        return Boolean(record.targetKey && target.key && record.targetKey === target.key)
            || Boolean(record.targetName && target.name && record.targetName === target.name);
    }

    async function historyForTarget(target) {
        const chatId = getCurrentChatIdentity();
        const all = await historyGetAll();
        return all
            .filter((item) => historyTargetMatches(item, target))
            .filter((item) => target?.kind !== 'char' || item.scope !== 'chat')
            .filter((item) => item.scope !== 'chat' || item.chatId === chatId)
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    }

    function revokeHistoryObjectUrls() {
        historyObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        historyObjectUrls.clear();
    }

    function formatHistoryTime(value) {
        try {
            return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
        } catch {
            return '';
        }
    }

    async function fetchAvatarBlob(url) {
        if (!url) throw new Error('找不到要备份的当前头像。');
        const response = await fetch(withCacheBust(url), { cache: 'no-store' });
        if (!response.ok) throw new Error(`读取当前头像失败（HTTP ${response.status}）。`);
        return response.blob();
    }

    function permanentAvatarUrl(target) {
        if (!target?.key) return target?.sourceUrl || '';
        return target.kind === 'user'
            ? `/User%20Avatars/${encodeURIComponent(target.key)}`
            : `/characters/${encodeURIComponent(target.key)}`;
    }

    async function saveHistorySnapshot(target, scope) {
        if (!target?.key) return null;
        try {
            const chatId = getCurrentChatIdentity();
            const currentOverride = scope === 'chat' ? getChatOverrideForTarget(target) : null;
            const sourceUrl = currentOverride ? chatOverrideUrl(currentOverride) : permanentAvatarUrl(target);
            const blob = await fetchAvatarBlob(sourceUrl);
            const record = {
                id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                createdAt: Date.now(),
                kind: target.kind,
                targetKey: target.key || '',
                targetName: target.name || '',
                charId: target.charId,
                scope: scope === 'chat' ? 'chat' : 'permanent',
                chatId: scope === 'chat' ? chatId : '',
                wasChatOverride: scope === 'chat' ? Boolean(currentOverride) : false,
                type: blob.type || 'image/png',
                blob,
            };
            await historyPut(record);
            const records = await historyForTarget(target);
            const sameScope = records.filter((item) => item.scope === record.scope && (record.scope !== 'chat' || item.chatId === chatId));
            for (const item of sameScope.slice(HISTORY_LIMIT)) await historyDelete(item.id);
            return record;
        } catch (error) {
            console.warn('[丘丘头像工作台] 保存头像历史失败，不阻止本次替换。', error);
            return null;
        }
    }

    async function renderHistory() {
        const list = modal?.querySelector('#qqaw-history-list');
        if (!list || !state.target) return;
        revokeHistoryObjectUrls();
        list.innerHTML = '<div class="qqaw-history-empty">正在读取头像历史…</div>';
        try {
            const records = await historyForTarget(state.target);
            if (!records.length) {
                list.innerHTML = '<div class="qqaw-history-empty">还没有历史记录。第一次替换头像后会自动保存旧头像。</div>';
                return;
            }
            list.innerHTML = '';
            records.forEach((record) => {
                const url = URL.createObjectURL(record.blob);
                historyObjectUrls.add(url);
                const card = document.createElement('article');
                card.className = 'qqaw-history-item';
                card.dataset.historyId = record.id;
                card.innerHTML = `
                    <img class="qqaw-history-thumb" alt="历史头像" />
                    <div class="qqaw-history-meta">
                        <span class="qqaw-history-scope ${record.scope === 'chat' ? 'is-chat' : 'is-permanent'}">${record.scope === 'chat' ? '本次聊天' : '永久'}</span>
                        <span class="qqaw-history-time">${formatHistoryTime(record.createdAt)}</span>
                    </div>
                    <div class="qqaw-history-actions">
                        <button type="button" class="qqaw-history-rollback" data-action="rollback">一键回滚</button>
                        <button type="button" class="qqaw-history-delete" data-action="delete" aria-label="删除这条历史" title="删除">×</button>
                    </div>`;
                card.querySelector('.qqaw-history-thumb').src = url;
                list.append(card);
            });
        } catch (error) {
            console.error('[丘丘头像工作台] 读取头像历史失败', error);
            list.innerHTML = '<div class="qqaw-history-empty">当前环境暂时无法读取头像历史。</div>';
        }
    }

    async function handleHistoryClick(event) {
        const button = event.target.closest?.('[data-action]');
        const card = event.target.closest?.('.qqaw-history-item');
        if (!button || !card) return;
        const id = card.dataset.historyId;
        if (button.dataset.action === 'delete') {
            await historyDelete(id);
            await renderHistory();
            return;
        }
        if (button.dataset.action !== 'rollback' || !state.target) return;
        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = '回滚中…';
        try {
            const records = await historyForTarget(state.target);
            const record = records.find((item) => item.id === id);
            if (!record) throw new Error('这条历史记录已经不存在。');
            await saveHistorySnapshot(state.target, record.scope);
            if (record.scope === 'chat') {
                if (record.wasChatOverride === false) {
                    await clearChatOverride(state.target);
                    await syncCurrentChatToPermanentPersona(state.target);
                } else {
                    await uploadChatScopedAvatar(state.target, record.blob);
                }
            } else {
                await clearChatOverride(state.target);
                if (state.target.kind === 'user') {
                    await uploadPersonaAvatar(state.target, record.blob);
                    await syncCurrentChatToPermanentPersona(state.target);
                } else {
                    await uploadCharacterAvatar(state.target, record.blob);
                }
            }
            await forceCurrentChatAvatarRefresh(state.target, { reload: true });
            await loadTargetImage(true);
            await renderHistory();
            notify('success', `已回滚到 ${formatHistoryTime(record.createdAt)} 的头像。`);
        } catch (error) {
            console.error('[丘丘头像工作台] 回滚失败', error);
            notify('error', error.message || '头像回滚失败。');
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    }

    async function clearCurrentHistory() {
        if (!state.target) return;
        try {
            const records = await historyForTarget(state.target);
            for (const record of records) await historyDelete(record.id);
            await renderHistory();
            notify('success', '当前头像的历史记录已清空。');
        } catch (error) {
            notify('error', error.message || '清空头像历史失败。');
        }
    }

    function getFullAvatarUrl(target) {
        const override = getChatOverrideForTarget(target);
        if (override) return chatOverrideUrl(override);
        if (!target?.key) return withCacheBust(target?.sourceUrl || '');
        if (target.kind === 'user') {
            return withCacheBust(`/User%20Avatars/${encodeURIComponent(target.key)}`);
        }
        return withCacheBust(`/characters/${encodeURIComponent(target.key)}`);
    }

    async function loadImageElement(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    async function loadTargetImage(resetFile = false) {
        if (!state.target) return;
        if (resetFile) {
            state.file = null;
            state.sourceKind = 'current';
            revokeObjectUrl();
        }
        const full = getFullAvatarUrl(state.target);
        const fallback = state.target.sourceUrl;
        const preview = modal.querySelector('#qqaw-preview-img');

        preview.classList.add('qqaw-loading');
        try {
            let image;
            try {
                image = await loadImageElement(full);
                state.sourceUrl = full;
            } catch {
                image = await loadImageElement(fallback);
                state.sourceUrl = fallback;
            }
            state.loadedImage = image;
            preview.src = state.sourceUrl;
            updatePreview();
        } catch (error) {
            console.error(error);
            notify('error', '当前头像加载失败。你仍然可以选择一张新图片。');
            preview.removeAttribute('src');
            state.loadedImage = null;
        } finally {
            preview.classList.remove('qqaw-loading');
        }
    }

    function onAvatarFilePicked(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        revokeObjectUrl();
        const objectUrl = URL.createObjectURL(file);
        state.objectUrl = objectUrl;
        state.file = file;
        state.sourceKind = 'file';
        state.layout = { ...DEFAULT_LAYOUT };
        loadImageElement(objectUrl).then((image) => {
            state.loadedImage = image;
            state.sourceUrl = objectUrl;
            modal.querySelector('#qqaw-preview-img').src = objectUrl;
            updatePreview();
        }).catch((error) => {
            console.error(error);
            notify('error', '无法读取这张图片。');
        });
        event.target.value = '';
    }

    function revokeObjectUrl() {
        if (state.objectUrl) {
            URL.revokeObjectURL(state.objectUrl);
            state.objectUrl = '';
        }
    }

    function renderPreviewCanvas() {
        const canvas = modal?.querySelector('#qqaw-preview-canvas');
        if (!canvas) return;
        const image = state.loadedImage;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const backingWidth = 600;
        const backingHeight = 900;
        if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
            canvas.width = backingWidth;
            canvas.height = backingHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!image?.naturalWidth || !image?.naturalHeight) return;

        const crop = computeCropRect(
            image.naturalWidth,
            image.naturalHeight,
            2 / 3,
            state.layout,
        );
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            image,
            crop.left,
            crop.top,
            crop.width,
            crop.height,
            0,
            0,
            canvas.width,
            canvas.height,
        );
    }

    function updatePanNote() {
        const note = modal?.querySelector('#qqaw-pan-note');
        if (!note) return;
        const image = state.loadedImage;
        if (!image?.naturalWidth || !image?.naturalHeight) {
            note.textContent = '';
            return;
        }
        const crop = computeCropRect(image.naturalWidth, image.naturalHeight, 2 / 3, state.layout);
        const horizontalRoom = Math.max(0, image.naturalWidth - crop.width);
        const verticalRoom = Math.max(0, image.naturalHeight - crop.height);
        if (horizontalRoom < 1) {
            note.textContent = '当前缩放下没有横向裁剪余量；把“缩放”稍微调大后，就可以左右移动。';
        } else if (verticalRoom < 1) {
            note.textContent = '当前缩放下没有纵向裁剪余量；把“缩放”稍微调大后，就可以上下移动。';
        } else {
            note.textContent = '水平、垂直位置都会直接改变最终裁剪区域。';
        }
    }

    function updatePreview() {
        if (!modal) return;
        state.layout = normalizeLayout(state.layout);
        renderPreviewCanvas();
        updatePanNote();

        const zoom = modal.querySelector('#qqaw-zoom');
        const x = modal.querySelector('#qqaw-x');
        const y = modal.querySelector('#qqaw-y');
        zoom.value = state.layout.zoom;
        x.value = state.layout.x;
        y.value = state.layout.y;
        modal.querySelector('#qqaw-zoom-value').value = `${state.layout.zoom.toFixed(2)}×`;
        modal.querySelector('#qqaw-x-value').value = `${Math.round(state.layout.x)}%`;
        modal.querySelector('#qqaw-y-value').value = `${Math.round(state.layout.y)}%`;
    }

    function pointerDistance(a, b) {
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function beginDrag(event) {
        if (!state.loadedImage) return;
        const shell = event.currentTarget;
        shell.setPointerCapture?.(event.pointerId);
        state.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

        if (state.pointers.size === 1) {
            state.dragging = true;
            state.dragStart = {
                clientX: event.clientX,
                clientY: event.clientY,
                x: state.layout.x,
                y: state.layout.y,
            };
            state.pinchStart = null;
        } else if (state.pointers.size >= 2) {
            const [a, b] = [...state.pointers.values()];
            state.dragging = false;
            state.dragStart = null;
            state.pinchStart = {
                distance: Math.max(1, pointerDistance(a, b)),
                zoom: state.layout.zoom,
            };
        }
    }

    function dragPreview(event) {
        if (!state.pointers.has(event.pointerId)) return;
        state.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

        if (state.pointers.size >= 2 && state.pinchStart) {
            const [a, b] = [...state.pointers.values()];
            const distance = Math.max(1, pointerDistance(a, b));
            state.layout.zoom = clamp(state.pinchStart.zoom * (distance / state.pinchStart.distance), 1, 3);
            updatePreview();
            return;
        }

        if (!state.dragging || !state.dragStart) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - state.dragStart.clientX;
        const dy = event.clientY - state.dragStart.clientY;
        const sensitivity = 100 / Math.max(1, state.layout.zoom);
        state.layout.x = clamp(state.dragStart.x - (dx / rect.width) * sensitivity, 0, 100);
        state.layout.y = clamp(state.dragStart.y - (dy / rect.height) * sensitivity, 0, 100);
        updatePreview();
    }

    function endDrag(event) {
        state.pointers.delete(event.pointerId);
        event.currentTarget.releasePointerCapture?.(event.pointerId);

        if (state.pointers.size === 1) {
            const [remaining] = [...state.pointers.values()];
            state.dragging = true;
            state.dragStart = {
                clientX: remaining.clientX,
                clientY: remaining.clientY,
                x: state.layout.x,
                y: state.layout.y,
            };
            state.pinchStart = null;
        } else if (state.pointers.size === 0) {
            state.dragging = false;
            state.dragStart = null;
            state.pinchStart = null;
        }
    }

    function onPreviewWheel(event) {
        if (!state.loadedImage) return;
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        state.layout.zoom = clamp(state.layout.zoom + delta, 1, 3);
        updatePreview();
    }

    async function saveCurrentDisplayLayout() {
        if (!state.target?.key) {
            notify('warning', '没有识别到当前头像文件，无法保存显示范围。');
            return;
        }
        try {
            await saveLayout(state.target, state.layout);
            refreshAllAvatarLayouts(document);
            notify('success', `${state.target.name || '当前头像'} 的显示范围已保存。`);
        } catch (error) {
            console.error(error);
            notify('error', error.message || '保存显示范围失败。');
        }
    }

    async function renderCropBlob() {
        const image = state.loadedImage;
        if (!image) throw new Error('还没有可裁剪的图片。');

        // SillyTavern 在默认设置下会把头像规范到 512×768。
        // 为避免上传 1:1 / 3:4 后再次被拉伸，这里始终直接生成标准 2:3 文件。
        // drawImage 的源裁剪框同样严格保持 2:3，因此只发生裁切与等比缩放，不会改变人物比例。
        const width = 512;
        const height = 768;
        const naturalW = image.naturalWidth || image.width;
        const naturalH = image.naturalHeight || image.height;
        const crop = computeCropRect(naturalW, naturalH, 2 / 3, state.layout);

        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            image,
            crop.left,
            crop.top,
            crop.width,
            crop.height,
            0,
            0,
            width,
            height,
        );

        return new Promise((resolve, reject) => {
            out.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成裁剪图片失败。')), 'image/png', 0.95);
        });
    }

    async function replaceAvatar() {
        if (state.target?.kind === 'char') state.replaceScope = 'permanent';
        if (!state.target?.key) {
            notify('warning', '没有识别到要替换的头像。');
            return;
        }
        if (state.replaceScope === 'permanent' && state.target.kind === 'char' && state.target.charId == null) {
            notify('warning', '永久替换需要识别到对应 Character。请从该角色的一条消息姓名后重新打开工作台。');
            return;
        }

        const button = modal.querySelector('#qqaw-replace-avatar');
        button.disabled = true;
        button.textContent = state.replaceScope === 'chat' ? '正在应用到本次聊天…' : '正在永久替换…';
        try {
            const blob = await renderCropBlob();
            await saveHistorySnapshot(state.target, state.replaceScope);
            if (state.replaceScope === 'chat') {
                await uploadChatScopedAvatar(state.target, blob);
            } else {
                // 如果这个聊天之前启用了临时头像，永久替换时先清掉临时覆盖，避免它继续遮住新头像。
                await clearChatOverride(state.target);
                if (state.target.kind === 'user') {
                    await uploadPersonaAvatar(state.target, blob);
                    await syncCurrentChatToPermanentPersona(state.target);
                } else {
                    await uploadCharacterAvatar(state.target, blob);
                }
            }

            state.layout = { ...DEFAULT_LAYOUT };
            await saveLayout(state.target, state.layout);
            state.file = null;
            state.sourceKind = 'current';
            revokeObjectUrl();
            await forceCurrentChatAvatarRefresh(state.target, { reload: true });
            await loadTargetImage(true);
            applyChatScopedOverrides(document);
            refreshAllAvatarLayouts(document);
            updatePreview();
            await renderHistory();
            notify(
                'success',
                state.replaceScope === 'chat'
                    ? `${state.target.name || '头像'} 已只在当前聊天中替换。`
                    : `${state.target.name || '头像'} 已永久替换。`,
            );
        } catch (error) {
            console.error('[丘丘头像工作台] 替换头像失败', error);
            notify('error', error.message || '替换头像失败。');
        } finally {
            button.disabled = false;
            syncTargetUi();
            syncReplaceScopeUi();
        }
    }

    async function forceCurrentChatAvatarRefresh(target, { reload = true } = {}) {
        const ctx = liveContext();
        const chat = document.querySelector('#chat');
        const distanceFromBottom = chat ? Math.max(0, chat.scrollHeight - chat.scrollTop - chat.clientHeight) : null;

        // v0.1.9 起聊天级 USER 头像已写入 message.force_avatar。
        // 因此可以安全走 SillyTavern 自己的重载流程，界面与聊天数据保持一致。
        if (reload) {
            try {
                if (typeof ctx.reloadCurrentChat === 'function') {
                    await ctx.reloadCurrentChat();
                }
            } catch (error) {
                console.warn('[丘丘头像工作台] reloadCurrentChat 失败，回退到 DOM 强制刷新。', error);
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } else {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        applyChatScopedOverrides(document);
        refreshLiveAvatar(target);
        scanMessages(document);
        scheduleChatOverrideReapply();

        const nextChat = document.querySelector('#chat');
        if (reload && nextChat && distanceFromBottom != null) {
            nextChat.scrollTop = Math.max(0, nextChat.scrollHeight - nextChat.clientHeight - distanceFromBottom);
        }
        setTimeout(() => {
            applyChatScopedOverrides(document);
            refreshLiveAvatar(target);
            scanMessages(document);
        }, 120);
    }

    function directAvatarUrl(target) {
        if (!target?.key) return '';
        return target.kind === 'user'
            ? `/User%20Avatars/${encodeURIComponent(target.key)}`
            : `/characters/${encodeURIComponent(target.key)}`;
    }

    function messageMatchesAvatarTarget(message, target) {
        if (!message || !target) return false;
        const candidate = getTargetFromMessage(message);
        if (!candidate || candidate.kind !== target.kind) return false;
        if (candidate.key && target.key && candidate.key === target.key) return true;
        if (target.kind === 'char' && candidate.charId != null && target.charId != null && candidate.charId === target.charId) return true;
        return Boolean(candidate.name && target.name && candidate.name === target.name);
    }

    function setFreshImageSource(img, src) {
        if (!img || !src) return;
        const picture = img.closest?.('picture');
        picture?.querySelectorAll?.('source').forEach((source) => source.removeAttribute('srcset'));
        img.removeAttribute('srcset');
        img.src = src;
        // 某些主题给 img 设置了 background-image，这里一并清掉旧缓存引用。
        if (img.style.backgroundImage) img.style.removeProperty('background-image');
    }

    function refreshLiveAvatar(target) {
        const override = getChatOverrideForTarget(target);
        const fresh = override ? withCacheBust(chatOverrideUrl(override)) : withCacheBust(directAvatarUrl(target));
        if (!fresh) return '';

        // 优先按“每条消息实际对应的 Persona / Character”匹配，兼容群聊和历史 Persona。
        document.querySelectorAll('#chat .mes:not(.template_element)').forEach((message) => {
            if (!messageMatchesAvatarTarget(message, target)) return;
            message.querySelectorAll('.avatar img').forEach((img) => setFreshImageSource(img, fresh));
        });

        // 再兜底刷新其他 UI 中使用同一头像文件的 img（角色面板、Persona 面板等）。
        document.querySelectorAll('.avatar img').forEach((img) => {
            const parsed = parseAvatarRef(img.src);
            if (!parsed?.file || parsed.file !== target.key) return;
            const expectedType = target.kind === 'user' ? 'persona' : 'avatar';
            if (parsed.type === expectedType) setFreshImageSource(img, fresh);
        });

        target.sourceUrl = fresh;
        state.sourceUrl = fresh;
        requestAnimationFrame(() => refreshAllAvatarLayouts(document));
        return fresh;
    }

    function scheduleLiveAvatarRefresh(target) {
        refreshLiveAvatar(target);
        requestAnimationFrame(() => refreshLiveAvatar(target));
        setTimeout(() => refreshLiveAvatar(target), 80);
        setTimeout(() => refreshLiveAvatar(target), 300);
    }

    async function uploadPersonaAvatar(target, blob) {
        const formData = new FormData();
        formData.append('avatar', avatarUploadFile(blob));
        formData.append('overwrite_name', target.key);

        const response = await fetch('/api/avatars/upload', {
            method: 'POST',
            headers: context.getRequestHeaders?.({ omitContentType: true }) ?? {},
            body: formData,
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Persona 头像上传失败（HTTP ${response.status}）。`);
        }

        scheduleLiveAvatarRefresh(target);
        await context.eventSource?.emit?.(context.eventTypes?.PERSONA_UPDATED, target.key);
        // 事件处理器可能异步重绘旧缩略图，再补几次缓存破坏刷新。
        scheduleLiveAvatarRefresh(target);
    }

    function valueOrEmpty(value) {
        return value == null ? '' : String(value);
    }

    function appendCharacterFormFields(formData, character) {
        const data = character.data ?? character;
        const extensions = deepClone(data.extensions ?? {});
        const depth = extensions.depth_prompt ?? {};
        const alternate = data.alternate_greetings ?? character.alternate_greetings ?? [];
        const tags = data.tags ?? character.tags ?? [];

        formData.append('avatar_url', valueOrEmpty(character.avatar));
        formData.append('ch_name', valueOrEmpty(data.name ?? character.name));
        formData.append('description', valueOrEmpty(data.description ?? character.description));
        formData.append('personality', valueOrEmpty(data.personality ?? character.personality));
        formData.append('scenario', valueOrEmpty(data.scenario ?? character.scenario));
        formData.append('first_mes', valueOrEmpty(data.first_mes ?? character.first_mes));
        formData.append('mes_example', valueOrEmpty(data.mes_example ?? character.mes_example));
        formData.append('creator_notes', valueOrEmpty(data.creator_notes ?? character.creator_notes));
        formData.append('system_prompt', valueOrEmpty(data.system_prompt ?? character.system_prompt));
        formData.append('post_history_instructions', valueOrEmpty(data.post_history_instructions ?? character.post_history_instructions));
        formData.append('creator', valueOrEmpty(data.creator ?? character.creator));
        formData.append('character_version', valueOrEmpty(data.character_version ?? character.character_version));
        formData.append('tags', Array.isArray(tags) ? tags.join(',') : valueOrEmpty(tags));
        formData.append('talkativeness', valueOrEmpty(character.talkativeness ?? data.talkativeness ?? 0.5));
        formData.append('fav', valueOrEmpty(character.fav ?? data.fav ?? false));
        formData.append('world', valueOrEmpty(extensions.world));
        formData.append('depth_prompt_prompt', valueOrEmpty(depth.prompt));
        formData.append('depth_prompt_depth', valueOrEmpty(depth.depth ?? 4));
        formData.append('depth_prompt_role', valueOrEmpty(depth.role ?? 'system'));
        formData.append('extensions', JSON.stringify(extensions));
        formData.append('chat', valueOrEmpty(character.chat));
        formData.append('create_date', valueOrEmpty(character.create_date));
        formData.append('json_data', character.json_data || JSON.stringify(data));

        if (Array.isArray(alternate)) {
            alternate.forEach((greeting) => formData.append('alternate_greetings', valueOrEmpty(greeting)));
        }
    }

    async function uploadCharacterAvatar(target, blob) {
        if (target.charId == null) throw new Error('无法确定 Character ID。');
        try {
            await context.unshallowCharacter?.(target.charId);
        } catch (error) {
            console.debug('[丘丘头像工作台] Character 已完整加载或无需 unshallow。', error);
        }

        const character = context.characters?.[target.charId] ?? target.character;
        if (!character) throw new Error('找不到 Character 数据。');
        target.character = character;
        target.key = character.avatar;

        const formData = new FormData();
        appendCharacterFormFields(formData, character);
        formData.append('avatar', avatarUploadFile(blob));

        const response = await fetch('/api/characters/edit', {
            method: 'POST',
            headers: context.getRequestHeaders?.({ omitContentType: true }) ?? {},
            body: formData,
            cache: 'no-cache',
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Character 头像保存失败（HTTP ${response.status}）${text ? `：${text.slice(0, 160)}` : ''}`);
        }

        await context.getOneCharacter?.(character.avatar);
        const updated = context.characters?.[target.charId] ?? character;
        target.character = updated;
        target.key = updated.avatar || character.avatar;
        target.name = updated.name || updated.data?.name || target.name;

        scheduleLiveAvatarRefresh(target);

        const eventPayload = { detail: { id: String(target.charId), character: updated } };
        await context.eventSource?.emit?.(context.eventTypes?.CHARACTER_EDITED, eventPayload);
        // Character edited 事件有时会异步触发旧缩略图重绘，再补几次强制刷新。
        scheduleLiveAvatarRefresh(target);
    }

    function applyIconUrl() {
        const input = modal.querySelector('#qqaw-icon-url');
        const url = input.value.trim();
        if (!url) {
            notify('warning', '请先填写图标 URL。');
            return;
        }
        settings.iconUrl = url;
        saveSettings();
        setAllWorkbenchIcons(url);
        notify('success', '工作台图标已更换。');
    }

    function applyLocalIcon(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            notify('warning', '本地图标超过 2 MB。为了避免扩展设置过大，建议改用图床 URL。');
            event.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            settings.iconUrl = String(reader.result);
            saveSettings();
            setAllWorkbenchIcons(settings.iconUrl);
            const iconInput = modal.querySelector('#qqaw-icon-url');
            iconInput.value = '';
            iconInput.placeholder = '已使用本地图标（可粘贴 URL 覆盖）';
            notify('success', '本地图标已应用。');
        };
        reader.onerror = () => notify('error', '读取本地图标失败。');
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    function resetWorkbenchIcon() {
        settings.iconUrl = DEFAULT_ICON_URL;
        saveSettings();
        modal.querySelector('#qqaw-icon-url').placeholder = 'https://...';
        modal.querySelector('#qqaw-icon-url').value = DEFAULT_ICON_URL;
        setAllWorkbenchIcons(DEFAULT_ICON_URL);
        notify('success', '已恢复丘丘头像工作台默认图标。');
    }

    function bindSillyTavernEvents() {
        const source = context.eventSource;
        const types = context.eventTypes ?? context.event_types;
        if (!source?.on || !types) return;

        const refresh = () => {
            setTimeout(() => {
                scanMessages(document);
                scheduleChatOverrideReapply();
            }, 0);
        };

        [
            types.CHAT_CHANGED,
            types.CHARACTER_EDITED,
            types.PERSONA_CHANGED,
            types.PERSONA_UPDATED,
            types.MESSAGE_RECEIVED,
            types.MESSAGE_UPDATED,
        ].filter(Boolean).forEach((eventName) => source.on(eventName, refresh));

        if (types.MESSAGE_SENT) {
            source.on(types.MESSAGE_SENT, async (messageId) => {
                try {
                    const ctx = liveContext();
                    const index = Number(messageId);
                    const message = Number.isInteger(index) ? ctx.chat?.[index] : null;
                    if (!message?.is_user) {
                        refresh();
                        return;
                    }

                    // 新发出的 USER 消息会由 ST 先写入 Persona 永久 force_avatar。
                    // 当前聊天若启用了临时头像，在消息数据层立即改成聊天级头像。
                    const overrides = allChatOverrides().filter((item) => item?.kind === 'user');
                    const override = overrides.find((item) => {
                        if (item.targetKey && message.original_avatar === item.targetKey) return true;
                        const parsed = parseAvatarRef(message.force_avatar || '');
                        if (item.targetKey && parsed?.file === item.targetKey) return true;
                        return Boolean(item.targetName && message.name && item.targetName === message.name);
                    }) || (overrides.length === 1 ? overrides[0] : null);

                    if (override) {
                        message.original_avatar = override.targetKey || message.original_avatar || '';
                        message.force_avatar = chatOverrideUrl(override);
                        await saveCurrentChatNow();
                    }
                } catch (error) {
                    console.warn('[丘丘头像工作台] 新 USER 消息同步临时头像失败', error);
                } finally {
                    refresh();
                }
            });
        }
    }

    function startObserver() {
        const root = document.querySelector('#chat') || document.body;
        observer = new MutationObserver((mutations) => {
            const messagesToReapply = new Set();
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        scanMessages(node);
                    });
                    continue;
                }

                // 关键修复：ST / 主题可能在消息已经存在后，再异步修改头像的
                // src / srcset。旧版只监听 addedNodes，因此最后一次写回永久头像
                // 无法被发现。现在属性变化也会触发对应消息的临时头像重应用。
                if (mutation.type === 'attributes') {
                    const element = mutation.target instanceof Element ? mutation.target : null;
                    const message = element?.closest?.('.mes');
                    if (message?.getAttribute('is_user') === 'true') messagesToReapply.add(message);
                }
            }

            if (messagesToReapply.size) {
                queueMicrotask(() => {
                    messagesToReapply.forEach((message) => applyChatOverrideToMessage(message));
                });
            }
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset'],
        });
    }

    async function waitForSillyTavern() {
        for (let i = 0; i < 100; i++) {
            if (globalThis.SillyTavern?.getContext) return globalThis.SillyTavern.getContext();
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('SillyTavern.getContext() 未就绪。');
    }

    async function init() {
        try {
            context = await waitForSillyTavern();
            ensureSettings();
            const clearedLegacyOverride = await migrateLegacyChatOverrideStore();
            buildModal();
            bindGlobalLauncher();
            addSettingsLauncher();
            scanMessages(document);
            bindSillyTavernEvents();
            startObserver();
            if (clearedLegacyOverride) {
                const ctx = liveContext();
                if (typeof ctx.reloadCurrentChat === 'function') {
                    await ctx.reloadCurrentChat();
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    scanMessages(document);
                }
                notify('info', '已清理旧版临时头像锁定状态。需要临时头像时请重新设置一次。');
            }
            console.info('[丘丘头像工作台] v0.1.9 已加载');
        } catch (error) {
            console.error('[丘丘头像工作台] 初始化失败', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
