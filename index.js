(() => {
    'use strict';

    const MODULE_ID = 'qiuqiu_avatar_workbench';
    const EXTENSION_FIELD = 'qiuqiu_avatar_workbench';
    const DEFAULT_ICON_URL = 'https://imgbed.heliar.top/i/hWLZsEjJm7_lklfn_IMG_1048.gif';
    const DEFAULT_LAYOUT = Object.freeze({ x: 50, y: 50, zoom: 1 });
    const DEFAULT_ASPECT = Object.freeze({ w: 2, h: 3, label: '2:3' });

    let context;
    let settings;
    let observer;
    let modal;
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
        };
    }

    function ensureSettings() {
        const current = context.extensionSettings?.[MODULE_ID] ?? {};
        settings = Object.assign(getDefaults(), current);
        settings.personaLayouts ??= {};
        settings.characterLayouts ??= {};
        context.extensionSettings[MODULE_ID] = settings;
    }

    function saveSettings() {
        context.saveSettingsDebounced?.();
    }

    function getIconUrl() {
        return settings.iconUrl?.trim() || DEFAULT_ICON_URL;
    }

    function setAllWorkbenchIcons(url) {
        document.querySelectorAll('.qqaw-name-button img, .qqaw-title-icon').forEach((img) => {
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
        if (!match && context.groupId == null && context.characterId != null && context.characterId !== '' && Number.isInteger(Number(context.characterId))) {
            const charId = Number(context.characterId);
            const character = context.characters?.[charId];
            if (character) match = { character, charId };
        }

        return {
            kind: 'char',
            key: parsed?.file || match?.character?.avatar || '',
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

    function createNameButton(message) {
        const name = message.querySelector('.name_text');
        if (!name || name.parentElement?.querySelector(':scope > .qqaw-name-button')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qqaw-name-button';
        button.title = '打开丘丘头像工作台';
        button.setAttribute('aria-label', '打开丘丘头像工作台');

        const img = document.createElement('img');
        img.src = getIconUrl();
        img.alt = '';
        button.append(img);

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = getTargetFromMessage(message);
            if (!target) {
                notify('warning', '没有识别到这条消息对应的头像。');
                return;
            }
            openWorkbench(target);
        });

        const nameFontSize = getComputedStyle(name).fontSize;
        if (nameFontSize) button.style.setProperty('--qqaw-name-size', nameFontSize);
        name.insertAdjacentElement('afterend', button);
    }

    function scanMessages(root = document) {
        const messages = root.matches?.('.mes') ? [root] : [...root.querySelectorAll?.('#chat .mes, .mes') ?? []];
        messages.forEach((message) => {
            if (message.classList.contains('template_element') || message.id === 'message_template') return;
            createNameButton(message);
        });
        refreshAllAvatarLayouts(root);
    }

    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = 'qqaw-overlay';
        overlay.className = 'qqaw-hidden';
        overlay.innerHTML = `
            <section id="qqaw-modal" role="dialog" aria-modal="true" aria-labelledby="qqaw-title">
                <header class="qqaw-header">
                    <div class="qqaw-title-wrap">
                        <img class="qqaw-title-icon" alt="" />
                        <div>
                            <div id="qqaw-title">丘丘头像工作台</div>
                            <div id="qqaw-subtitle">快速更换 · 自由裁剪 · 非破坏式构图</div>
                        </div>
                    </div>
                    <button type="button" id="qqaw-close" class="qqaw-icon-button" aria-label="关闭">×</button>
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
                                <img id="qqaw-preview-img" alt="头像预览" draggable="false" />
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
                                <div class="qqaw-control-title">裁剪比例</div>
                                <div class="qqaw-chip-row" id="qqaw-aspect-row">
                                    <button type="button" data-ratio="2:3" class="qqaw-chip active">2:3</button>
                                    <button type="button" data-ratio="1:1" class="qqaw-chip">1:1</button>
                                    <button type="button" data-ratio="3:4" class="qqaw-chip">3:4</button>
                                    <button type="button" data-ratio="4:5" class="qqaw-chip">4:5</button>
                                </div>
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

                            <button type="button" id="qqaw-replace-avatar" class="menu_button qqaw-dangerous">裁剪并替换头像</button>
                            <div class="qqaw-small-note">此操作会按上方预览真正生成一张新 PNG，并覆盖当前 Persona / Character 头像。</div>
                        </section>
                    </div>

                    <details class="qqaw-icon-settings">
                        <summary>工作台图标设置</summary>
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
                            <div class="qqaw-small-note">支持 PNG / JPG / WebP / GIF。图标会显示在消息姓名后面，并与姓名等高。</div>
                        </div>
                    </details>
                </div>
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
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeWorkbench();
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

        modal.querySelectorAll('#qqaw-aspect-row [data-ratio]').forEach((button) => {
            button.addEventListener('click', () => setAspect(button.dataset.ratio));
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
    }

    function setAspect(ratio) {
        const map = {
            '2:3': { w: 2, h: 3, label: '2:3' },
            '1:1': { w: 1, h: 1, label: '1:1' },
            '3:4': { w: 3, h: 4, label: '3:4' },
            '4:5': { w: 4, h: 5, label: '4:5' },
        };
        state.aspect = map[ratio] ?? { ...DEFAULT_ASPECT };
        settings.preferredAspect = state.aspect.label;
        saveSettings();
        modal.querySelectorAll('#qqaw-aspect-row [data-ratio]').forEach((button) => {
            button.classList.toggle('active', button.dataset.ratio === state.aspect.label);
        });
        const shell = modal.querySelector('#qqaw-preview-shell');
        shell.style.setProperty('--qqaw-aspect-w', state.aspect.w);
        shell.style.setProperty('--qqaw-aspect-h', state.aspect.h);
    }

    function openWorkbench(target) {
        if (!modal) buildModal();
        state.target = target;
        state.layout = getSavedLayout(target);
        state.file = null;
        state.sourceKind = 'current';
        state.aspect = parseAspect(settings.preferredAspect || '2:3');
        modal.classList.remove('qqaw-hidden');
        document.body.classList.add('qqaw-modal-open');
        modal.querySelector('#qqaw-icon-url').value = settings.iconUrl || DEFAULT_ICON_URL;
        syncTargetUi();
        setAspect(state.aspect.label);
        updatePreview();
        loadTargetImage(true);
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
    }

    function parseAspect(value) {
        const [w, h] = String(value).split(':').map(Number);
        if (!w || !h) return { ...DEFAULT_ASPECT };
        return { w, h, label: `${w}:${h}` };
    }

    function syncTargetUi() {
        const target = state.target;
        modal.querySelector('#qqaw-target-name').textContent = target?.name || '未识别';
        modal.querySelector('#qqaw-target-file').textContent = target?.key || '未识别头像文件';
        modal.querySelectorAll('.qqaw-target-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.kind === target?.kind);
        });
        const replaceButton = modal.querySelector('#qqaw-replace-avatar');
        const canReplace = Boolean(target?.key) && (target.kind === 'user' || target.charId != null);
        replaceButton.disabled = !canReplace;
        replaceButton.title = canReplace ? '' : '没有识别到可编辑的 Character / Persona，无法覆盖头像。';
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
        syncTargetUi();
        updatePreview();
        loadTargetImage(true);
    }

    function withCacheBust(url) {
        if (!url) return '';
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}qqaw=${Date.now()}`;
    }

    function getFullAvatarUrl(target) {
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

    function updatePreview() {
        if (!modal) return;
        state.layout = normalizeLayout(state.layout);
        const img = modal.querySelector('#qqaw-preview-img');
        img.style.setProperty('--qqaw-x', `${state.layout.x}%`);
        img.style.setProperty('--qqaw-y', `${state.layout.y}%`);
        img.style.setProperty('--qqaw-zoom', String(state.layout.zoom));

        if (supportsObjectViewBox() && state.loadedImage?.naturalWidth && state.loadedImage?.naturalHeight) {
            const crop = computeCropRect(
                state.loadedImage.naturalWidth,
                state.loadedImage.naturalHeight,
                state.aspect.w / state.aspect.h,
                state.layout,
            );
            const value = `xywh(${crop.left.toFixed(3)}px ${crop.top.toFixed(3)}px ${crop.width.toFixed(3)}px ${crop.height.toFixed(3)}px)`;
            img.style.setProperty('object-view-box', value);
        } else {
            img.style.removeProperty('object-view-box');
        }

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

    function outputSizeForAspect(aspect) {
        if (aspect.w === 2 && aspect.h === 3) return { width: 512, height: 768 };
        const longSide = 768;
        if (aspect.w >= aspect.h) {
            return { width: longSide, height: Math.round(longSide * aspect.h / aspect.w) };
        }
        return { width: Math.round(longSide * aspect.w / aspect.h), height: longSide };
    }

    async function renderCropBlob() {
        const image = state.loadedImage;
        if (!image) throw new Error('还没有可裁剪的图片。');

        const { width, height } = outputSizeForAspect(state.aspect);
        const naturalW = image.naturalWidth || image.width;
        const naturalH = image.naturalHeight || image.height;
        const crop = computeCropRect(naturalW, naturalH, width / height, state.layout);

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
        if (!state.target?.key) {
            notify('warning', '没有识别到要替换的头像。');
            return;
        }
        if (state.target.kind === 'char' && state.target.charId == null) {
            notify('warning', '没有识别到对应 Character。请从该角色的一条消息姓名后重新打开工作台。');
            return;
        }

        const button = modal.querySelector('#qqaw-replace-avatar');
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = '正在替换…';
        try {
            const blob = await renderCropBlob();
            if (state.target.kind === 'user') {
                await uploadPersonaAvatar(state.target, blob);
            } else {
                await uploadCharacterAvatar(state.target, blob);
            }

            state.layout = { ...DEFAULT_LAYOUT };
            await saveLayout(state.target, state.layout);
            state.file = null;
            state.sourceKind = 'current';
            revokeObjectUrl();
            await loadTargetImage(true);
            refreshAllAvatarLayouts(document);
            updatePreview();
            notify('success', `${state.target.name || '头像'} 已裁剪并替换。`);
        } catch (error) {
            console.error('[丘丘头像工作台] 替换头像失败', error);
            notify('error', error.message || '替换头像失败。');
        } finally {
            button.disabled = false;
            button.textContent = oldText;
            syncTargetUi();
        }
    }

    async function uploadPersonaAvatar(target, blob) {
        const formData = new FormData();
        formData.append('avatar', new File([blob], 'qiuqiu-avatar.png', { type: 'image/png' }));
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

        const thumbBase = context.getThumbnailUrl?.('persona', target.key)
            || `/thumbnail?type=persona&file=${encodeURIComponent(target.key)}`;
        const thumb = withCacheBust(thumbBase);
        document.querySelectorAll('.avatar img').forEach((img) => {
            const parsed = parseAvatarRef(img.src);
            if (parsed?.type === 'persona' && parsed.file === target.key) img.src = thumb;
        });
        target.sourceUrl = thumb;
        state.sourceUrl = thumb;
        await context.eventSource?.emit?.(context.eventTypes?.PERSONA_UPDATED, target.key);
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
        formData.append('avatar', new File([blob], 'qiuqiu-avatar.png', { type: 'image/png' }));

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

        const thumbBase = context.getThumbnailUrl?.('avatar', target.key)
            || `/thumbnail?type=avatar&file=${encodeURIComponent(target.key)}`;
        const thumb = withCacheBust(thumbBase);
        document.querySelectorAll('.avatar img').forEach((img) => {
            const parsed = parseAvatarRef(img.src);
            if (parsed?.type === 'avatar' && parsed.file === target.key) img.src = thumb;
        });
        target.sourceUrl = thumb;
        state.sourceUrl = thumb;

        const eventPayload = { detail: { id: String(target.charId), character: updated } };
        await context.eventSource?.emit?.(context.eventTypes?.CHARACTER_EDITED, eventPayload);
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

        const refresh = () => setTimeout(() => scanMessages(document), 0);
        [
            types.CHAT_CHANGED,
            types.CHARACTER_EDITED,
            types.PERSONA_CHANGED,
            types.PERSONA_UPDATED,
            types.MESSAGE_RECEIVED,
            types.MESSAGE_SENT,
            types.MESSAGE_UPDATED,
        ].filter(Boolean).forEach((eventName) => source.on(eventName, refresh));
    }

    function startObserver() {
        const root = document.querySelector('#chat') || document.body;
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof Element)) return;
                    scanMessages(node);
                });
            }
        });
        observer.observe(root, { childList: true, subtree: true });
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
            buildModal();
            scanMessages(document);
            bindSillyTavernEvents();
            startObserver();
            console.info('[丘丘头像工作台] v0.1.0 已加载');
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
