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

    // Local storage key for persistent toggle state
    const STORAGE_KEY = 'hideMetaEnabled_leftRight_v2';
    // Local storage key for floating button position
    const FLOAT_POS_KEY = 'hideMetaFloatingBtnPos_v1';

    let hideEnabled = true; // default; may be overwritten by storage/state
    let disableDynamicHiding = false;  // when true, dynamic hiding is paused (via popup)

    // Mutation observers (to keep in sync with dynamic content)
    let observerLeft = null;
    let observerRight = null;

    // UI elements
    let popupEl = null;

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
        // Fallback: try any nested span text
        const span = row.querySelector('span');
        if (span && span.textContent) return span.textContent.trim();
        return '';
    }

    // Hide functions for both trees
    function hideLeftMetaInRoot(root) {
        if (!root) return;
        const items = root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem');
        items.forEach(it => {
            const name = getLeftItemName(it);
            if (name && name.endsWith('.meta')) {
                it.style.display = 'none';
            }
        });
    }

    function showLeftMetaInRoot(root) {
        if (!root) return;
        const items = root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem');
        items.forEach(it => {
            const name = getLeftItemName(it);
            if (name && name.endsWith('.meta')) {
                it.style.display = '';
            }
        });
    }

    function hideRightMetas() {
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const name = getRightRowName(row);
            if (name && name.endsWith('.meta')) {
                row.style.display = 'none';
            }
        });
    }

    function showRightMetas() {
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const name = getRightRowName(row);
            if (name && name.endsWith('.meta')) {
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
            popupHidden: 'Hidden .meta files',
            popupShow: 'Show',
            tipShown: 'Meta files are shown. Click to hide.',
            tipHidden: 'Meta files are hidden. Click to show.'
        },
        ja: {
            popupHidden: '.meta ファイルを非表示にしました',
            popupShow: '表示する',
            tipShown: 'meta ファイルは表示中。クリックで非表示。',
            tipHidden: 'meta ファイルは非表示中。クリックで表示。'
        },
        zh: {
            popupHidden: '已隐藏 meta 文件',
            popupShow: '显示',
            tipShown: 'meta 文件已显示，点击隐藏',
            tipHidden: 'meta 文件已隐藏，点击显示'
        }
    };
    function t(key) {
        return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || '';
    }

    // Floating draggable toggle button
    let floatingBtn = null;

    const BTN_SIZE = 32;

    function getExtensionIconUrl(fileName) {
        // Content scripts run on github.com; relative URLs resolve to github.com.
        // For extensions (including "Load unpacked"), runtime.getURL is the correct way.
        try {
            const rt = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
                : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
                    : null;
            if (rt && typeof rt.getURL === 'function') {
                return rt.getURL('icons/' + fileName);
            }
        } catch { }

        // Last resort: most likely wrong on github.com, but keep as a fallback.
        return 'icons/' + fileName;
    }

    function verifyIconLoad(url) {
        try {
            const img = new Image();
            img.onload = () => { /* ok */ };
            img.onerror = () => {
                // This helps diagnose path / permission issues from DevTools
                console.warn('[HideMeta] Failed to load icon:', url);
            };
            img.src = url;
        } catch { }
    }

    function iconForState() {
        const url = hideEnabled
            ? getExtensionIconUrl('visibilitytoggleoff.png')
            : getExtensionIconUrl('visibilitytoggleon.png');
        verifyIconLoad(url);
        return url;
    }

    function tooltipForState() {
        // eye open => metas shown
        return hideEnabled ? t('tipHidden') : t('tipShown');
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
        // Use clientWidth/clientHeight to exclude scrollbar area
        const vw = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;
        const vh = document.documentElement ? document.documentElement.clientHeight : window.innerHeight;

        const x = clamp(px, 0, Math.max(0, vw - size));
        const y = clamp(py, 0, Math.max(0, vh - size));
        floatingBtn.style.left = x + 'px';
        floatingBtn.style.top = y + 'px';
    }

    function updateFloatingButtonUI() {
        if (!floatingBtn) return;
        floatingBtn.title = tooltipForState();
        const img = floatingBtn.querySelector('img');
        if (img) {
            img.src = iconForState();
            img.alt = hideEnabled ? 'meta hidden' : 'meta shown';
        }
    }

    function createFloatingButton() {
        const btn = document.createElement('button');
        btn.id = 'hide-meta-floating-btn';
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
        img.alt = hideEnabled ? 'meta hidden' : 'meta shown';
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

        function snapToEdgeAndPersist() {
            const size = BTN_SIZE;
            const margin = 8;
            const left = parseFloat(btn.style.left || '0') || 0;
            const top = parseFloat(btn.style.top || '0') || 0;

            // Exclude scrollbar area when deciding/snap target
            const vw = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;

            const centerX = left + size / 2;
            const snapLeft = centerX < vw / 2;
            const snappedX = snapLeft ? margin : Math.max(margin, vw - size - margin);

            setButtonPosition(snappedX, top);

            const finalLeft = parseFloat(btn.style.left || '0') || 0;
            const finalTop = parseFloat(btn.style.top || '0') || 0;
            saveButtonPos({ x: finalLeft, y: finalTop });
        }

        function onUp(e) {
            if (!dragging) return;
            dragging = false;
            // Persist then snap to nearest side
            snapToEdgeAndPersist();
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
            hideEnabled = !hideEnabled;
            localStorage.setItem(STORAGE_KEY, hideEnabled ? '1' : '0');
            if (hideEnabled) applyHideAll(); else applyShowAll();
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
            if (!floatingBtn) return;
            const left = parseFloat(floatingBtn.style.left || '0') || 0;
            const top = parseFloat(floatingBtn.style.top || '0') || 0;
            setButtonPosition(left, top);
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
        } else {
            if (floatingBtn) removeFloatingButton();
        }
    }

    // Page/SPA checks and navigation handling
    function isGitHubRepoPage() {
        return /^\/[^\/]+\/[^\/]+/.test(location.pathname);
    }

    function leftHasMeta() {
        const root = document.querySelector(LEFT_ROOT);
        if (!root) return false;
        let found = false;
        root.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem').forEach(it => {
            const nm = getLeftItemName(it);
            if (nm && nm.endsWith('.meta')) found = true;
        });
        return found;
    }

    function rightHasMeta() {
        let found = false;
        document.querySelectorAll('.react-directory-row').forEach(row => {
            const nm = getRightRowName(row);
            if (nm && nm.endsWith('.meta')) found = true;
        });
        return found;
    }

    function hasMetaOnPage() {
        return leftHasMeta() || rightHasMeta();
    }

    // Setup incremental observers
    function setupObservers() {
        const leftRoot = document.querySelector(LEFT_ROOT);
        if (leftRoot) {
            observerLeft = new MutationObserver(() => {
                if (disableDynamicHiding) return;
                if (hideEnabled) applyHideAll();
                maybeUpdateFloatingButtonVisibility();
            });
            observerLeft.observe(leftRoot, { childList: true, subtree: true });
        }

        const rightRoot = document.querySelector(RIGHT_ROOT);
        if (rightRoot) {
            observerRight = new MutationObserver(() => {
                if (disableDynamicHiding) return;
                if (hideEnabled) applyHideAll();
                maybeUpdateFloatingButtonVisibility();
            });
            observerRight.observe(rightRoot, { childList: true, subtree: true });
        }
    }

    // Initialize after DOM ready
    function init() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) {
            hideEnabled = stored === '1';
        } else {
            hideEnabled = isGitHubRepoPage() && hasMetaOnPage();
        }

        if (hideEnabled) applyHideAll();
        maybeUpdateFloatingButtonVisibility();
        setupObservers();

        setTimeout(() => {
            if (hasMetaOnPage()) showPopup();
        }, 400);

        patchLocationChange();
        window.addEventListener('locationchange', onLocationChange);
        window.addEventListener('popstate', onLocationChange);
    }

    function onLocationChange() {
        disableDynamicHiding = false;

        if (observerLeft) observerLeft.disconnect();
        if (observerRight) observerRight.disconnect();
        observerLeft = observerRight = null;

        const repoPage = isGitHubRepoPage();
        const hasMeta = hasMetaOnPage();
        if (repoPage && hasMeta) {
            maybeUpdateFloatingButtonVisibility();
            if (hideEnabled) applyHideAll();
        } else {
            removeFloatingButton();
        }

        setupObservers();
    }

    function patchLocationChange() {
        if (history.__hideMetaPatched) return;
        history.__hideMetaPatched = true;

        const pushState = history.pushState;
        history.pushState = function () { pushState.apply(history, arguments); window.dispatchEvent(new Event('locationchange')); };
        const replaceState = history.replaceState;
        history.replaceState = function () { replaceState.apply(history, arguments); window.dispatchEvent(new Event('locationchange')); };
    }

    function showPopup() {
        if (popupEl) return;
        const p = document.createElement('div');
        p.id = 'meta-hide-popup';
        p.innerHTML = `<span>${t('popupHidden')}</span>  <a href="#" id="disable-meta-hide" style="color:#0a58e9; text-decoration:underline; cursor:pointer;">${t('popupShow')}</a>`;
        Object.assign(p.style, {
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(0)',
            background: '#24292f', color: '#fff', padding: '10px 16px', borderRadius: '6px',
            fontSize: '13px', zIndex: '9999', display: 'flex', gap: '12px', alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', opacity: '0', transition: 'opacity 0.25s ease, transform 0.25s ease'
        });
        const link = p.querySelector('#disable-meta-hide');
        if (link) {
            link.addEventListener('click', e => {
                e.preventDefault();
                disableDynamicHiding = true;
                applyShowAll();

                if (observerLeft) observerLeft.disconnect();
                if (observerRight) observerRight.disconnect();
                p.style.opacity = '0';
                p.style.transform = 'translateX(-50%) translateY(20px)';
                setTimeout(() => p.remove(), 250);
            });
        }
        document.body.appendChild(p);
        popupEl = p;
        requestAnimationFrame(() => {
            p.style.opacity = '1';
            p.style.transform = 'translateX(-50%) translateY(0)';
        });
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
})();