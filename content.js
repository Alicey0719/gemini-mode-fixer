// content.js — Gemini Mode Fixer
// Google Gemini を開いたとき、設定したモードに自動で切り替えます。

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ▼ ユーザー設定 / メンテナンスポイント
//
//  Gemini が新バージョン（4.0, 5.0 …）になってモード切り替えが動かなくなった場合、
//  まず Chrome DevTools (F12) の Console で [GeminiModeFixer] のログを確認し、
//  実際に表示されているモデル名テキストを MODE_CONFIG の match 配列に追記してください。
//
//  例: Gemini 4.0 で "Ultra" というモードが追加された場合
//    → popup.html に新カードを追加し、MODE_CONFIG に 'ultra' を追加
// ═══════════════════════════════════════════════════════════════════════════

// ─── デフォルト設定（storage に値がない場合） ────────────────────────────────
const DEFAULT_SETTINGS = { 
  mode: 'flash', 
  enabled: true,
  delayMs: 100  // 初回待機時間（ミリ秒）
};

// ─── 内部待機時間設定（パフォーマンスチューニング） ──────────────────────────
// 高速化したい場合はこれらの値をさらに小さくできますが、不安定になる可能性があります
const TIMING = {
  DOM_SETTLE: 10,           // DOM 変化後の落ち着き待機
  DROPDOWN_TIMEOUT: 10,    // ドロップダウン展開タイムアウト
  CLICK_REFLECT: 10,        // クリック後の反映待機
  RETRY_BACKOFF_MAX: 400,  // リトライの最大待機時間
  PAGE_INIT: 500,           // ページ読み込み後の初期化待機
  DIRECT_CHECK: 30,         // 直接切り替え後の確認待機
  MENU_CLOSE: 30,           // メニューを閉じる際の待機
};

/**
 * モードごとのマッチ設定
 *
 * match    : テキストに含まれるべきキーワード（小文字、いずれか1つ）
 *              新バージョンで名称が変わったらここに追記するだけで対応可能
 * exclude  : このキーワードが含まれていたら除外（誤マッチ防止）
 * boundary : true の場合、単語境界(\b)でマッチ（"professional"が"pro"にマッチしないよう）
 */
const MODE_CONFIG = {
  flash: {
    match:    ['flash', '高速'],
    exclude:  ['thinking', 'pro', 'experimental'],
    boundary: false,  // 日本語は単語境界が効かないのでfalseに
  },
  thinking: {
    match:    ['thinking', '思考'],
    exclude:  [],
    boundary: false,
  },
  pro: {
    match:    ['pro'],
    exclude:  ['thinking', '思考', 'experimental'],
    boundary: true,
  },
};

// 回数制限時のフォールバック順（高性能順）
const MODE_PRIORITY = ['pro', 'thinking', 'flash'];

/**
 * モデルセレクタボタンを探すための CSS セレクタ候補。
 * Gemini の DOM が変わった場合はここに新しいセレクタを追加。
 * 上から順に試し、最初にマッチした要素を使用。
 */
const SELECTOR_CANDIDATES = [
  // aria-label ベース（最も安定）
  '[aria-label*="model" i]',
  '[aria-label*="mode" i]',
  '[aria-label*="モデル"]',
  '[aria-label*="モード"]',
  // data 属性ベース
  '[data-test-id*="model" i]',
  '[data-test-id*="mode" i]',
  '[data-model-id]',
  // コンポーネント名ベース（Angular/Lit などのカスタム要素）
  'bard-mode-switcher',
  'model-switcher',
  'gemini-model-switcher',
  'ms-model-selector',
  // クラス名ベース（最後の手段、変更頻度が高い）
  '[class*="model-switcher"]',
  '[class*="mode-switcher"]',
  '[class*="model-selector"]',
  '[class*="model-picker"]',
];

/**
 * ドロップダウンのメニュー項目を探すための CSS セレクタ候補。
 */
const MENU_ITEM_SELECTORS = [
  '[data-test-id*="mode" i]',  // Geminiの新UIで使用されている
  '[role="menuitem"]',
  '[role="option"]',
  '[role="listitem"]',
  'mat-option',
  '[class*="model-option"]',
  '[class*="mode-option"]',
  '[class*="model-item"]',
  '[class*="menu-item"]',
];

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * テキストが指定モードにマッチするか判定。
 * boundary: true の場合は単語境界マッチで誤マッチを防ぐ。
 */
function textMatchesMode(text, mode) {
  const lower = text.toLowerCase();
  const cfg = MODE_CONFIG[mode];
  if (!cfg) return false;

  const testKw = (kw) => {
    if (cfg.boundary && /^[a-z]+$/.test(kw)) {
      return new RegExp(`\\b${escapeRegex(kw)}\\b`).test(lower);
    }
    return lower.includes(kw);
  };

  const hasMatch   = cfg.match.some(testKw);
  const hasExclude = cfg.exclude.some(testKw);
  return hasMatch && !hasExclude;
}

/** 要素のテキストを再帰的に取得 */
function getDeepText(el) {
  return (el.innerText || el.textContent || '').trim();
}

/**
 * ボタンのラベルを取得。
 * innerText が空の場合（アイコンのみのボタン）は aria-label / title / data-tooltip を使用。
 */
function getButtonLabel(el) {
  const candidates = [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-tooltip'),
    el.getAttribute('data-value'),
    getDeepText(el),
  ];
  return (candidates.find((s) => s && s.trim()) || '').trim();
}

/** 指定 ms 待機 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DOM が変化するまで待機（ドロップダウン展開検知用）。
 * @param {number} timeoutMs - タイムアウト ms
 */
function waitForDomChange(timeoutMs = TIMING.DROPDOWN_TIMEOUT) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeoutMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      observer.disconnect();
      setTimeout(resolve, TIMING.DOM_SETTLE);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ─── Shadow DOM 対応 深部探索 ─────────────────────────────────────────────────

/**
 * Shadow DOM を再帰的に走査して querySelectorAll を実行。
 * Gemini は Web Components / Shadow DOM を多用するため通常の
 * querySelectorAll では届かない要素がある。
 */
function deepQueryAll(root, selector) {
  const found = [];
  function walk(r) {
    try { found.push(...r.querySelectorAll(selector)); } catch {}
    try {
      r.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    } catch {}
  }
  walk(root);
  return found;
}

/**
 * Shadow DOM を含む全要素のうちテキストを持つものを収集。
 * メニュー項目の fallback 走査に使用。
 */
function deepGetAllTextElements(root) {
  const found = [];
  function walk(r) {
    try {
      r.querySelectorAll('*').forEach((el) => {
        const text = getDeepText(el);
        if (text && text.length > 0 && text.length < 200) found.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    } catch {}
  }
  walk(root);
  return found;
}

// ─── DOM 検索 ────────────────────────────────────────────────────────────────

/**
 * モデルセレクタボタンを探す。
 * Shadow DOM も含めて SELECTOR_CANDIDATES を順番に試し、
 * 最後の手段としてラベルテキストでも検索。
 */
function findModelSelectorButton() {
  // 除外すべきラベルキーワード（会話オプションメニューなどを除外）
  const excludeKeywords = ['オプション', 'その他', 'options', 'more', '固定', '名前を変更', 'rename', 'pin'];
  
  // 戦略 1: Shadow DOM 含む深部探索
  for (const sel of SELECTOR_CANDIDATES) {
    const els = deepQueryAll(document, sel);
    if (els.length > 0) {
      // 複数ヒットした場合は条件でフィルタリング
      const validEls = els.filter(el => {
        const label = getButtonLabel(el);
        const labelLower = label.toLowerCase();
        
        // 除外キーワードが含まれている場合はスキップ
        if (excludeKeywords.some(kw => labelLower.includes(kw.toLowerCase()))) {
          return false;
        }
        
        // 可視性とサイズをチェック
        const r = el.getBoundingClientRect();
        return r.width < 400 && r.height < 200 && r.width > 0 && r.height > 0;
      });
      
      if (validEls.length > 0) {
        // モード名を含むものを優先
        const withModeName = validEls.find(el => {
          const label = getButtonLabel(el);
          return Object.keys(MODE_CONFIG).some(mode => textMatchesMode(label, mode));
        });
        
        return withModeName || validEls[0];
      }
    }
  }

  // 戦略 2: ラベル（aria-label, title）にモード名を含むボタン
  const candidates = deepQueryAll(document, 'button, [role="button"], mat-select');
  for (const el of candidates) {
    const label = getButtonLabel(el);
    const labelLower = label.toLowerCase();
    
    // 除外キーワードチェック
    if (excludeKeywords.some(kw => labelLower.includes(kw.toLowerCase()))) {
      continue;
    }
    
    if (label.length < 120) {
      for (const mode of Object.keys(MODE_CONFIG)) {
        if (textMatchesMode(label, mode)) {
          return el;
        }
      }
    }
  }

  return null;
}

/**
 * メニュー項目が回数制限・無効化されているか判定。
 */
function isMenuItemUnavailable(item) {
  if (!item) return true;
  if (item.getAttribute('aria-disabled') === 'true') return true;
  if (item.hasAttribute('disabled')) return true;
  const cls = (item.className || '').toLowerCase();
  if (['disabled', 'unavailable', 'inactive'].some(c => cls.includes(c))) return true;
  const text = getDeepText(item).toLowerCase();
  return ['回数制限', 'rate limit', 'unavailable', '利用不可', '上限', 'exceeded'].some(kw => text.includes(kw));
}

/**
 * 現在開いているドロップダウンから、excludeMode を除く中で最も高性能な利用可能モードを返す。
 */
function findBestAvailableMode(excludeMode) {
  for (const m of MODE_PRIORITY) {
    if (m === excludeMode) continue;
    const item = findMenuItemForMode(m);
    if (item && !isMenuItemUnavailable(item)) return m;
  }
  return null;
}

/**
 * 開いているドロップダウンから指定モードに対応するメニュー項目を探す。
 * Shadow DOM を含む深部探索を実施。
 */
function findMenuItemForMode(mode) {
  // 戦略 1: MENU_ITEM_SELECTORS を Shadow DOM 含む深部探索
  for (const sel of MENU_ITEM_SELECTORS) {
    const items = deepQueryAll(document, sel);
    for (const item of items) {
      const text = getDeepText(item);
      if (text && text.length < 150 && textMatchesMode(text, mode)) {
        return item;
      }
    }
  }

  // 戦略 2: Shadow DOM 含む全テキスト要素から探す（最後の手段）
  const allTextEls = deepGetAllTextElements(document);
  for (const el of allTextEls) {
    const text = getDeepText(el);
    if (text && text.length < 150 && textMatchesMode(text, mode)) {
      // クリック可能な要素か、またはその親がクリック可能か確認
      const clickable = el.closest('[role="menuitem"], [role="option"], [role="listitem"], button, [role="button"], li') || el;
      return clickable;
    }
  }

  return null;
}

/**
 * ページ内の複数の場所から現在のモードを検出。
 * ボタンラベルだけでなく、bard-mode-switcher や他のモード表示要素も確認。
 */
function detectCurrentMode() {
  // 候補1: bard-mode-switcher 要素
  const modeSwitchers = deepQueryAll(document, 'bard-mode-switcher');
  for (const el of modeSwitchers) {
    const text = getDeepText(el);
    if (text && text.length < 100) {
      for (const mode of Object.keys(MODE_CONFIG)) {
        if (textMatchesMode(text, mode)) {
          return { mode, text, source: 'bard-mode-switcher', element: el };
        }
      }
    }
  }
  
  // 候補2: モード選択ボタンのラベル
  const btn = findModelSelectorButton();
  if (btn) {
    const label = getButtonLabel(btn);
    if (label && label.length < 200) {
      for (const mode of Object.keys(MODE_CONFIG)) {
        if (textMatchesMode(label, mode)) {
          return { mode, text: label, source: 'button', element: btn };
        }
      }
    }
  }
  
  // 候補3: data-test-id="mode-*" 要素
  const modeElements = deepQueryAll(document, '[data-test-id*="mode"]');
  for (const el of modeElements) {
    const text = getDeepText(el);
    if (text && text.length > 0 && text.length < 100) {
      for (const mode of Object.keys(MODE_CONFIG)) {
        if (textMatchesMode(text, mode)) {
          return { mode, text, source: 'data-test-id', element: el };
        }
      }
    }
  }
  
  return null;
}

/**
 * カスタム要素やReact/Angularの内部プロパティを直接操作してモードを切り替え（UI操作なし）
 */
async function switchModeDirectly(mode) {
  // 戦略1: bard-mode-switcher のカスタム要素プロパティを操作
  const modeSwitchers = deepQueryAll(document, 'bard-mode-switcher');
  for (const switcher of modeSwitchers) {
    const modeMapping = { flash: 'flash', thinking: 'thinking', pro: 'pro' };
    const targetMode = modeMapping[mode];
    
    // 試行: プロパティに直接値を設定
    for (const prop of ['mode', 'model', 'selectedMode', 'selectedModel', 'value', '_mode', '_model']) {
      if (prop in switcher) {
        try {
          switcher[prop] = targetMode;
          switcher.dispatchEvent(new Event('change', { bubbles: true }));
          switcher.dispatchEvent(new CustomEvent('mode-changed', { detail: { mode: targetMode }, bubbles: true }));
        } catch (e) {}
      }
    }
    
    // メソッド呼び出しを試行
    for (const method of ['selectMode', 'setMode', 'changeMode', 'selectModel', 'setModel']) {
      if (typeof switcher[method] === 'function') {
        try {
          switcher[method](targetMode);
        } catch (e) {}
      }
    }
  }
  
  await sleep(TIMING.DIRECT_CHECK);
  
  // 切り替え確認
  const updatedModeInfo = detectCurrentMode();
  return updatedModeInfo && updatedModeInfo.mode === mode;
}

// ─── モード切り替えロジック ───────────────────────────────────────────────────

let isSwitching = false;

/**
 * 指定モードへ切り替える。
 * まず直接操作を試し、失敗した場合のみUI操作にフォールバック。
 * @param {string} mode - 'flash' | 'thinking' | 'pro'
 * @param {number} retries - 最大リトライ回数（デフォルト: 6）
 * @param {number} delayMs - 初回待機時間（ミリ秒、デフォルト: 100）
 */
async function switchToMode(mode, retries = 6, delayMs = 100) {
  if (isSwitching) return;
  if (!(mode in MODE_CONFIG)) return;

  isSwitching = true;

  try {
    // 初回のモード確認
    const currentModeInfo = detectCurrentMode();
    if (currentModeInfo && currentModeInfo.mode === mode) return;

    // 戦略A: UI操作なしで直接切り替えを試行
    const directSuccess = await switchModeDirectly(mode);
    if (directSuccess) return;
    
    let wait = delayMs;
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (wait > 0) await sleep(wait);
      wait = Math.min(wait * 1.5, TIMING.RETRY_BACKOFF_MAX);

      const btn = findModelSelectorButton();
      if (!btn) continue;

      btn.click();
      await waitForDomChange();

      const menuItem = findMenuItemForMode(mode);
      if (menuItem) {
        if (isMenuItemUnavailable(menuItem)) {
          // 回数制限: 最善の利用可能モードへフォールバック（リトライしない）
          const fallbackMode = findBestAvailableMode(mode);
          if (fallbackMode) {
            const fallbackItem = findMenuItemForMode(fallbackMode);
            if (fallbackItem && !isMenuItemUnavailable(fallbackItem)) {
              fallbackItem.click();
              await sleep(TIMING.CLICK_REFLECT);
              return;
            }
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(TIMING.MENU_CLOSE);
          return;
        }

        menuItem.click();
        await sleep(TIMING.CLICK_REFLECT);

        // 反映確認（複数箇所をチェック）
        const updatedModeInfo = detectCurrentMode();
        if (updatedModeInfo && updatedModeInfo.mode === mode) return;
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(TIMING.MENU_CLOSE);
      }
    }
  } catch (e) {
    // エラーを無視
  } finally {
    isSwitching = false;
  }
}

/** チャット画面（/app*）かどうかを判定 */
function isOnAppPage() {
  return location.pathname.startsWith('/app');
}

/**
 * ストレージから設定を読み込んでモード切り替えを実行。
 * /app* ページ以外では動作しない（検索・履歴画面などへの誤作動を防止）。
 */
function runModeFixer() {
  if (!isOnAppPage()) return;
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    if (!settings.enabled) return;
    switchToMode(settings.mode, 6, settings.delayMs);
  });
}

// ─── SPA ナビゲーション対応（URL 変化の監視） ────────────────────────────────

let lastUrl = location.href;

const navObserver = new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    setTimeout(runModeFixer, TIMING.PAGE_INIT * 2);
  }
});

if (document.body) {
  navObserver.observe(document.body, { childList: true, subtree: true });
}

// ─── 初回実行 ────────────────────────────────────────────────────────────────

// Gemini は SPA のため document_idle でも UI が未構築の場合がある。
// ページが完全に安定してから実行する。
function safeRunModeFixer() {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => setTimeout(runModeFixer, TIMING.PAGE_INIT), { timeout: 2000 });
  } else {
    setTimeout(runModeFixer, TIMING.PAGE_INIT);
  }
}

if (document.readyState === 'complete') {
  safeRunModeFixer();
} else {
  window.addEventListener('load', safeRunModeFixer, { once: true });
}
