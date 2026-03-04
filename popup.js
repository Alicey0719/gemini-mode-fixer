// popup.js
// デフォルト設定
const DEFAULT_SETTINGS = {
  mode: 'flash',       // 'flash' | 'thinking' | 'pro'
  enabled: true,
  delayMs: 100         // 初回待機時間（ミリ秒）
};

const MODE_LABELS = {
  flash: '高速モード (Flash)',
  thinking: '思考モード (Thinking)',
  pro: 'Pro'
};

// 設定を読み込んで UI に反映
function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    // モードカードの選択状態を更新
    selectModeCard(settings.mode);

    // トグルを更新
    document.getElementById('enabled-toggle').checked = settings.enabled;

    // スライダーを更新
    const delaySlider = document.getElementById('delay-slider');
    const delayValue = document.getElementById('delay-value');
    delaySlider.value = settings.delayMs;
    delayValue.textContent = `${settings.delayMs}ms`;

    // ステータスバーを更新
    updateStatus(settings.enabled, settings.mode);
  });
}

// モードカードを選択状態にする
function selectModeCard(mode) {
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.classList.remove('selected');
  });

  const card = document.getElementById(`card-${mode}`);
  if (card) {
    card.classList.add('selected');
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  }
}

// ステータスバーを更新
function updateStatus(enabled, mode) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  if (enabled) {
    dot.classList.remove('inactive');
    text.textContent = `有効 — 次回起動時に「${MODE_LABELS[mode]}」を設定します`;
  } else {
    dot.classList.add('inactive');
    text.textContent = '無効 — 自動切り替えはオフです';
  }
}

// モードカードのクリックイベント
document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;

    const mode = radio.value;

    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      const newSettings = { ...settings, mode };
      chrome.storage.sync.set(newSettings, () => {
        selectModeCard(mode);
        updateStatus(newSettings.enabled, mode);
      });
    });
  });
});

// 有効/無効トグルのイベント
document.getElementById('enabled-toggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    const newSettings = { ...settings, enabled };
    chrome.storage.sync.set(newSettings, () => {
      updateStatus(enabled, newSettings.mode);
    });
  });
});

// 待機時間スライダーのイベント
const delaySlider = document.getElementById('delay-slider');
const delayValue = document.getElementById('delay-value');

delaySlider.addEventListener('input', (e) => {
  const delayMs = parseInt(e.target.value, 10);
  delayValue.textContent = `${delayMs}ms`;
});

delaySlider.addEventListener('change', (e) => {
  const delayMs = parseInt(e.target.value, 10);

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    const newSettings = { ...settings, delayMs };
    chrome.storage.sync.set(newSettings);
  });
});

// 初期化
loadSettings();
