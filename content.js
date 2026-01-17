(function() {
  // Language support (en / ja)
  const LANG = (navigator.language && /^ja/i.test(navigator.language)) ? 'ja' : 'en';

  // Selectors for left (Files tree) and right (GitHub file list) panels
  const LEFT_ROOT = "ul[role='tree'][aria-label='Files']";
  const RIGHT_ROOT = ".react-directory";

  // Local storage key for persistent toggle state
  const STORAGE_KEY = 'hideMetaEnabled_leftRight_v2';
  let hideEnabled = true; // default enabled; will be overwritten by storage/state check

  // Helpers to extract item names from left and right trees
  function getLeftItemName(item) {
    if (!item) return '';
    // Try common wrappers used by the left tree
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
    const rightRoot = document.querySelector(RIGHT_ROOT);
    hideLeftMetaInRoot(leftRoot);
    hideRightMetas();
  }

  function applyShowAll() {
    const leftRoot = document.querySelector(LEFT_ROOT);
    showLeftMetaInRoot(leftRoot);
    showRightMetas();
  }

  // Detect whether there are any .meta files in the current page
  function detectAnyMetaFiles() {
    let found = false;
    const leftRoot = document.querySelector(LEFT_ROOT);
    if (leftRoot) {
      leftRoot.querySelectorAll('li.PRIVATE_TreeView-item, li.prc-TreeView-TreeViewItem').forEach(it => {
        const name = getLeftItemName(it);
        if (name && name.endsWith('.meta')) found = true;
      });
    }
    document.querySelectorAll('.react-directory-row').forEach(row => {
      const n = getRightRowName(row);
      if (n && n.endsWith('.meta')) found = true;
    });
    return found;
  }

  // Simple UI toggle for live show/hide without refresh
  let toggleBtn = null;
  function labelForToggle() {
    if (LANG === 'ja') {
      return hideEnabled ? '表示する' : '非表示にする';
    } else {
      return hideEnabled ? 'Show .meta' : 'Hide .meta';
    }
  }

  function createToggleUI() {
    const btn = document.createElement('button');
    btn.id = 'hide-meta-toggle';
    // Center bottom placement with hyperlink-like appearance
    btn.style.position = 'fixed';
    btn.style.bottom = '20px';
    btn.style.left = '50%';
    btn.style.transform = 'translateX(-50%)';
    btn.style.zIndex = '9999';
    btn.style.background = 'transparent';
    btn.style.border = '0';
    btn.style.padding = '6px 12px';
    btn.style.fontSize = '12px';
    btn.style.cursor = 'pointer';
    btn.style.color = '#1a73e8';
    btn.style.textDecoration = 'underline';
    btn.style.boxShadow = 'none';
    btn.style.borderRadius = '6px';
    btn.style.userSelect = 'none';
    btn.setAttribute('aria-pressed', String(hideEnabled));

    // Initial label
    btn.textContent = labelForToggle();

    btn.addEventListener('click', () => {
      hideEnabled = !hideEnabled;
      localStorage.setItem(STORAGE_KEY, hideEnabled ? '1' : '0');
      btn.setAttribute('aria-pressed', String(hideEnabled));
      // Update label after state change
      btn.textContent = labelForToggle();
      // Apply actions
      if (hideEnabled) {
        applyHideAll();
      } else {
        applyShowAll();
      }
    });

    // Hyperlink-like highlight on hover for guidance
    btn.addEventListener('mouseenter', () => {
      btn.style.color = '#0b63e2';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.color = '#1a73e8';
    });
    btn.addEventListener('focus', () => {
      btn.style.outline = '2px solid #1a73e8';
    });
    btn.addEventListener('blur', () => {
      btn.style.outline = 'none';
    });

    document.body.appendChild(btn);
    toggleBtn = btn;
  }

  function updateToggleLabel() {
    if (!toggleBtn) return;
    toggleBtn.setAttribute('aria-pressed', String(hideEnabled));
    toggleBtn.textContent = labelForToggle();
  }

  // init
  function initState() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      hideEnabled = stored === '1';
    } else {
      hideEnabled = detectAnyMetaFiles();
    }
  }

  function setupObservers() {
    const leftRoot = document.querySelector(LEFT_ROOT);
    if (leftRoot) {
      const obLeft = new MutationObserver(() => {
        if (hideEnabled) applyHideAll();
      });
      obLeft.observe(leftRoot, { childList: true, subtree: true });
    }
    const rightRoot = document.querySelector(RIGHT_ROOT);
    if (rightRoot) {
      const obRight = new MutationObserver(() => {
        if (hideEnabled) applyHideAll();
      });
      obRight.observe(rightRoot, { childList: true, subtree: true });
    }
  }

  // Initialize after DOM ready
  function init() {
    initState();
    if (hideEnabled) {
      applyHideAll();
    }
    createToggleUI();
    setupObservers();
    // confirm state after a moment
    setTimeout(() => {
      if (hideEnabled) applyHideAll();
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
