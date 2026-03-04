# Gemini Mode Fixer

Google Gemini を開いたとき、**高速モード (Flash) / 思考モード (Thinking) / Pro** のいずれかを自動で選択する Chrome 拡張機能です。

> **Gemini 3.0 以降対応**: バージョン番号に依存しない設計のため、将来のバージョンアップにも追従しやすい構造になっています。

---

## 機能

- Gemini 起動時に指定したモードへ自動切り替え
- ポップアップ UI でワンクリック設定変更
- 有効 / 無効のトグルスイッチ
- SPA（シングルページアプリ）対応：ページ内遷移にも追従
- 指数的バックオフ付きリトライ（最大 6 回、最大待機 5 秒）

---

## ファイル構成

```
gemini-mode-fixer/
├── manifest.json   # 拡張機能の定義（Manifest V3）
├── popup.html      # ポップアップ UI
├── popup.js        # ポップアップのロジック
├── content.js      # Gemini ページで動作するコンテンツスクリプト
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## インストール方法

1. Chrome のアドレスバーに `chrome://extensions` と入力して開く
2. 右上の **「デベロッパーモード」** を ON にする
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. このフォルダ (`gemini-mode-fixer`) を選択する
5. 拡張機能が追加されたことを確認する

---

## 使い方

1. Chrome ツールバーの **Gemini Mode Fixer アイコン** をクリック
2. 起動したいモードを選択：
   - **高速モード** — Gemini 2.0 Flash（素早い回答）
   - **思考モード** — Flash Thinking（深い推論）
   - **Pro** — Gemini 2.0 Pro（高品質な回答）
3. 「自動切り替えを有効にする」トグルが ON になっていることを確認
4. `https://gemini.google.com` を開くと、約 2〜3 秒後に自動でモードが切り替わる

---

## 注意事項

- **Google Gemini の UI は定期的に更新されます。** UI の変更によりセレクタが機能しなくなる場合があります。その際は下記「メンテナンス方法」を参照してください。
- 切り替えに失敗した場合は Chrome の開発者ツール（F12）→ Console に `[GeminiModeFixer]` で始まるログが出力されます。

---

## Gemini バージョンアップ後の対応方法

1. Gemini を開き、DevTools (F12) → `[GeminiModeFixer]` のログを確認
2. セレクタが見つからない場合は `content.js` の `SELECTOR_CANDIDATES` に新しい CSS セレクタを追記
3. メニュー項目が見つからない場合は `MODE_CONFIG` に新しいキーワードを追記

```js
// content.js — MODE_CONFIG への追記例（モデル名が変わった場合）
const MODE_CONFIG = {
  flash: {
    match:    ['flash', '高速'],   // ← ここに追記
    exclude:  ['thinking', 'pro', 'experimental'],
    boundary: true,
  },
  // ...
};

// SELECTOR_CANDIDATES への追記例（DOM 構造が変わった場合）
const SELECTOR_CANDIDATES = [
  '[aria-label*="model" i]',   // 既存
  '[data-new-attribute]',      // ← 新しいセレクタを追記
  // ...
];
```

---

## カスタマイズ

`content.js` の `MODE_CONFIG` を編集することで、マッチングするキーワードを変更できます。  
**バージョン番号（"3.0", "4.0" 等）は含めず、モデル名のベース部分のみを指定**することで将来のバージョンアップに自動追従します。

```js
const MODE_CONFIG = {
  flash: {
    match:    ['flash'],                      
    exclude:  ['thinking', 'pro', 'experimental'],
    boundary: true,                               // 単語境界でマッチ（誤マッチ防止）
  },
  thinking: {
    match:    ['thinking', '思考'],
    exclude:  [],
    boundary: true,
  },
  pro: {
    match:    ['pro'],
    exclude:  ['thinking', '思考', 'experimental'],
    boundary: true,
  },
};
```
