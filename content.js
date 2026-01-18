(function () {
    // Language support (en / ja / zh)
    const LANG = (function () {
        const lang = (navigator.language || '').toLowerCase();
        if (lang.startsWith('ja')) return 'ja';
        if (lang.startsWith('zh')) return 'zh';
        return 'en';
    })();

    // Selectors for left (Files tree) and right (GitHub file list) panels
    const LEFT_ROOT = "ul[role='tree'][aria-label='Files']";
    const RIGHT_ROOT = ".react-directory";

    // Local storage key for floating button position
    const FLOAT_POS_KEY = 'hideMetaFloatingBtnPos_v1';

    const SETTINGS_KEY = 'unityMetaFilterSettings_v1';

    const DEFAULT_SETTINGS = {
        filterLeftTree: true,
        filterRightList: true
    };

    let settings = { ...DEFAULT_SETTINGS };

    // Session-only master switch for the floating button
    let enabledForThisPage = true;

    // Mutation observers (to keep in sync with dynamic content)
    let observerLeft = null;
    let observerRight = null;

    // Extra observer: GitHub often swaps the file list via SPA without replacing the LEFT/RIGHT roots immediately.
    // When a page initially has no .meta files, our per-root observers won't be created, so we need a fallback
    // observer to re-bind once the relevant containers appear.
    let observerBootstrap = null;

    // Helpers to extract item names from left and right trees
    function getLeftItemName(item) {
        if (!item) return '';
        const nameEl = item.querySelector('.PRIVATE_TreeView-item-content-text span')
            || item.querySelector('.prc-TreeView-TreeViewItemContentText-FFaKp span')
            || item.querySelector('span');
        if (nameEl && nameEl.textContent) return nameEl.textContent.trim();
        return item.textContent ? item.textContent.trim() : '';
    }

    function getRightRowName(row) {
        if (!row) return '';
        const cell = row.querySelector('.react-directory-filename-cell');
        if (cell && cell.textContent) return cell.textContent.trim();
        const span = row.querySelector('span');
        if (span && span.textContent) return span.textContent.trim();
        return '';
    }

    function isUnityMeta(name) {
        return !!name && name.endsWith('.meta');
    }

    // Hide/show functions for both trees
    function hideLeftMetaInRoot(root) {
        if (!root || !enabledForThisPage || !settings.filterLeftTree) return;
        const items = root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem');
        items.forEach(it => {
            const name = getLeftItemName(it);
            if (isUnityMeta(name)) {
                it.style.display = 'none';
            }
        });
    }

    function showLeftMetaInRoot(root) {
        if (!root) return;
        const items = root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem');
        items.forEach(it => {
            const name = getLeftItemName(it);
            if (isUnityMeta(name)) {
                it.style.display = '';
            }
        });
    }

    function hideRightMetas() {
        if (!enabledForThisPage || !settings.filterRightList) return;
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const name = getRightRowName(row);
            if (isUnityMeta(name)) {
                row.style.display = 'none';
            }
        });
    }

    function showRightMetas() {
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const name = getRightRowName(row);
            if (isUnityMeta(name)) {
                row.style.display = '';
            }
        });
    }

    function applyHideAll() {
        const leftRoot = document.querySelector(LEFT_ROOT);
        hideLeftMetaInRoot(leftRoot);
        hideRightMetas();
    }

    function applyShowAll() {
        const leftRoot = document.querySelector(LEFT_ROOT);
        showLeftMetaInRoot(leftRoot);
        showRightMetas();
    }

    // Simple localization
    const I18N = {
        en: {
            tipEnabled: 'Unity .meta files are hidden. Click to show.',
            tipDisabled: 'Unity .meta files are shown. Click to hide.'
        },
        ja: {
            tipEnabled: 'Unity .meta は非表示中。クリックで表示。',
            tipDisabled: 'Unity .meta は表示中。クリックで非表示。'
        },
        zh: {
            tipEnabled: 'Unity .meta 已隐藏，点击显示',
            tipDisabled: 'Unity .meta 已显示，点击隐藏'
        }
    };
    function t(key) {
        return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || '';
    }

    // Floating draggable toggle button
    let floatingBtn = null;

    const BTN_SIZE = 32;

    function getExtensionIconUrl(fileName) {
        try {
            const rt = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
                : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
                    : null;
            if (rt && typeof rt.getURL === 'function') {
                return rt.getURL('icons/' + fileName);
            }
        } catch { }
        return 'icons/' + fileName;
    }

    function verifyIconLoad(url) {
        try {
            const img = new Image();
            img.onerror = () => console.warn('[UnityMetaFilter] Failed to load icon:', url);
            img.src = url;
        } catch { }
    }

    function iconForState() {
        // enabled => hiding .meta => "off" icon means "visibility off"
        const url = enabledForThisPage
            ? getExtensionIconUrl('visibilitytoggleoff.png')
            : getExtensionIconUrl('visibilitytoggleon.png');
        verifyIconLoad(url);
        return url;
    }

    function tooltipForState() {
        return enabledForThisPage ? t('tipEnabled') : t('tipDisabled');
    }

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    function getDefaultButtonPos() {
        const size = BTN_SIZE;
        const margin = 20;
        const vw = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;
        const vh = document.documentElement ? document.documentElement.clientHeight : window.innerHeight;
        return {
            x: Math.max(margin, (vw - size - margin)),
            y: Math.max(margin, (vh - size - margin))
        };
    }

    function loadButtonPos() {
        try {
            const raw = localStorage.getItem(FLOAT_POS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function saveButtonPos(pos) {
        try {
            localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
        } catch { }
    }

    function setButtonPosition(px, py) {
        if (!floatingBtn) return;
        const size = BTN_SIZE;
        const vw = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;
        const vh = document.documentElement ? document.documentElement.clientHeight : window.innerHeight;

        const x = clamp(px, 0, Math.max(0, vw - size));
        const y = clamp(py, 0, Math.max(0, vh - size));
        floatingBtn.style.left = x + 'px';
        floatingBtn.style.top = y + 'px';
    }

    function snapToEdgeAndPersist(btn) {
        const size = BTN_SIZE;
        const margin = 8;
        const left = parseFloat(btn.style.left || '0') || 0;
        const top = parseFloat(btn.style.top || '0') || 0;
        const vw = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;

        const centerX = left + size / 2;
        const snapLeft = centerX < vw / 2;
        const snappedX = snapLeft ? margin : Math.max(margin, vw - size - margin);

        setButtonPosition(snappedX, top);

        const finalLeft = parseFloat(btn.style.left || '0') || 0;
        const finalTop = parseFloat(btn.style.top || '0') || 0;
        saveButtonPos({ x: finalLeft, y: finalTop });
    }

    function syncFloatingButtonPosition() {
        if (!floatingBtn) return;
        snapToEdgeAndPersist(floatingBtn);
    }

    function updateFloatingButtonUI() {
        if (!floatingBtn) return;
        floatingBtn.title = tooltipForState();
        const img = floatingBtn.querySelector('img');
        if (img) {
            img.src = iconForState();
            img.alt = enabledForThisPage ? 'meta hidden' : 'meta shown';
        }
    }

    function createFloatingButton() {
        const btn = document.createElement('button');
        btn.id = 'unity-meta-filter-floating-btn';
        btn.type = 'button';
        Object.assign(btn.style, {
            position: 'fixed',
            width: BTN_SIZE + 'px',
            height: BTN_SIZE + 'px',
            borderRadius: '9999px',
            border: '1px solid rgba(0,0,0,0.15)',
            background: '#ffffff',
            zIndex: '9999',
            padding: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.20)',
            cursor: 'pointer',
            userSelect: 'none'
        });

        const img = document.createElement('img');
        img.src = iconForState();
        img.alt = enabledForThisPage ? 'meta hidden' : 'meta shown';
        Object.assign(img.style, {
            width: '18px',
            height: '18px',
            pointerEvents: 'none'
        });
        btn.appendChild(img);

        const pos = loadButtonPos() || getDefaultButtonPos();
        btn.style.left = (pos.x || 0) + 'px';
        btn.style.top = (pos.y || 0) + 'px';

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let originLeft = 0;
        let originTop = 0;

        function getClientPoint(e) {
            if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        function onDown(e) {
            if (e.type === 'mousedown' && e.button !== 0) return;
            dragging = true;
            moved = false;
            const pt = getClientPoint(e);
            startX = pt.x;
            startY = pt.y;
            originLeft = parseFloat(btn.style.left || '0') || 0;
            originTop = parseFloat(btn.style.top || '0') || 0;
            e.preventDefault();
        }

        function onMove(e) {
            if (!dragging) return;
            const pt = getClientPoint(e);
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            setButtonPosition(originLeft + dx, originTop + dy);
            e.preventDefault();
        }

        function onUp(e) {
            if (!dragging) return;
            dragging = false;
            snapToEdgeAndPersist(btn);
            e.preventDefault();
        }

        btn.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        btn.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp, { passive: false });

        btn.addEventListener('click', (e) => {
            if (moved) {
                e.preventDefault();
                return;
            }
            enabledForThisPage = !enabledForThisPage;
            if (enabledForThisPage) applyHideAll(); else applyShowAll();
            updateFloatingButtonUI();
            maybeUpdateFloatingButtonVisibility();
            e.preventDefault();
        });

        btn.addEventListener('mouseenter', () => {
            btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.20)';
        });

        document.body.appendChild(btn);
        floatingBtn = btn;
        updateFloatingButtonUI();

        window.addEventListener('resize', () => {
            syncFloatingButtonPosition();
        });
    }

    function removeFloatingButton() {
        if (floatingBtn && floatingBtn.parentNode) floatingBtn.parentNode.removeChild(floatingBtn);
        floatingBtn = null;
    }

    function maybeUpdateFloatingButtonVisibility() {
        const shouldShow = isGitHubRepoPage() && hasMetaOnPage();
        if (shouldShow) {
            if (!floatingBtn) createFloatingButton();
            updateFloatingButtonUI();
            syncFloatingButtonPosition();
        } else {
            if (floatingBtn) removeFloatingButton();
        }
    }

    function setupBootstrapObserver() {
        if (observerBootstrap) return;

        observerBootstrap = new MutationObserver(() => {
            // Re-bind per-root observers when GitHub replaces panels.
            const leftRoot = document.querySelector(LEFT_ROOT);
            const rightRoot = document.querySelector(RIGHT_ROOT);

            // If any root exists but we are not observing it yet, re-setup.
            const needLeft = !!leftRoot && !observerLeft;
            const needRight = !!rightRoot && !observerRight;

            if (needLeft || needRight) {
                if (observerLeft) observerLeft.disconnect();
                if (observerRight) observerRight.disconnect();
                observerLeft = observerRight = null;
                setupObservers();
            }

            // Always re-evaluate button visibility on significant DOM swaps.
            maybeUpdateFloatingButtonVisibility();
            if (enabledForThisPage) applyHideAll();
        });

        // Observe the whole body; cheap callback + quick checks.
        observerBootstrap.observe(document.body, { childList: true, subtree: true });
    }

    // Setup incremental observers
    function setupObservers() {
        const leftRoot = document.querySelector(LEFT_ROOT);
        if (leftRoot) {
            observerLeft = new MutationObserver(() => {
                if (enabledForThisPage) applyHideAll();
                maybeUpdateFloatingButtonVisibility();
            });
            observerLeft.observe(leftRoot, { childList: true, subtree: true });
        }

        const rightRoot = document.querySelector(RIGHT_ROOT);
        if (rightRoot) {
            observerRight = new MutationObserver(() => {
                if (enabledForThisPage) applyHideAll();
                maybeUpdateFloatingButtonVisibility();
            });
            observerRight.observe(rightRoot, { childList: true, subtree: true });
        }
    }

    async function loadSettings() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                const res = await chrome.storage.sync.get(SETTINGS_KEY);
                if (res && res[SETTINGS_KEY]) {
                    settings = { ...DEFAULT_SETTINGS, ...res[SETTINGS_KEY] };
                }
            }
        } catch { }
    }

    function onLocationChange() {
        if (observerLeft) observerLeft.disconnect();
        if (observerRight) observerRight.disconnect();
        observerLeft = observerRight = null;

        const repoPage = isGitHubRepoPage();
        const hasMeta = hasMetaOnPage();
        if (repoPage && hasMeta) {
            maybeUpdateFloatingButtonVisibility();
            if (enabledForThisPage) applyHideAll();
        } else {
            removeFloatingButton();
        }

        setupObservers();
        syncFloatingButtonPosition();

        // GitHub SPA navigation may update the DOM after location change.
        // Do a delayed re-check to ensure button/observers are created when content arrives.
        setTimeout(() => {
            maybeUpdateFloatingButtonVisibility();
            if (enabledForThisPage) applyHideAll();
        }, 300);
    }

    function patchLocationChange() {
        if (history.__unityMetaFilterPatched) return;
        history.__unityMetaFilterPatched = true;

        const pushState = history.pushState;
        history.pushState = function () { pushState.apply(history, arguments); window.dispatchEvent(new Event('locationchange')); };
        const replaceState = history.replaceState;
        history.replaceState = function () { replaceState.apply(history, arguments); window.dispatchEvent(new Event('locationchange')); };
    }

    function setupMessageListener() {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener((msg) => {
                    if (!msg || msg.type !== 'UMF_SETTINGS_UPDATED') return;
                    if (msg.settings && typeof msg.settings === 'object') {
                        settings = { ...DEFAULT_SETTINGS, ...msg.settings };

                        // If user disabled one side, immediately unhide once so UI matches.
                        // Then re-apply hiding for the remaining enabled panels.
                        if (msg.forceRefresh) {
                            applyShowAll();
                        }

                        if (enabledForThisPage) applyHideAll(); else applyShowAll();
                        maybeUpdateFloatingButtonVisibility();
                    }
                });
            }
        } catch { }
    }

    // Initialize after DOM ready
    async function init() {
        await loadSettings();

        if (enabledForThisPage) applyHideAll();
        maybeUpdateFloatingButtonVisibility();
        setupObservers();
        setupBootstrapObserver();

        patchLocationChange();
        setupMessageListener();
        window.addEventListener('locationchange', onLocationChange);
        window.addEventListener('popstate', onLocationChange);
    }

    function setup() {
        patchLocationChange();
        init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    function isGitHubRepoPage() {
        return /^\/[^\/]+\/[^\/]+/.test(location.pathname);
    }

    function leftHasMeta() {
        const root = document.querySelector(LEFT_ROOT);
        if (!root) return false;
        let found = false;
        root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem').forEach(it => {
            const nm = getLeftItemName(it);
            if (isUnityMeta(nm)) found = true;
        });
        return found;
    }

    function rightHasMeta() {
        let found = false;
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const nm = getRightRowName(row);
            if (isUnityMeta(nm)) found = true;
        });
        return found;
    }

    function hasMetaOnPage() {
        return leftHasMeta() || rightHasMeta();
    }
})();