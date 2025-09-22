# searchKey

將頁面上的執行期物件建立可搜尋索引，並注入 `$searchKey()` 以跨「全域」與「框架掛載節點」定位值/函式。

## Project Name and Description

- 名稱：searchKey
- 目的：在任意網頁內建立一份可搜尋的索引，提供 `$searchKey(key, fuzzy?)` 來快速找到對應的屬性/函式位置（路徑），支援精確與模糊搜尋，並排除原生函式結果。

## Technology Stack

- 語言：TypeScript（嚴格模式）
- 執行環境：Browser（僅限瀏覽器；使用 `window`/`document`）
- 標準庫/型別：`lib: ["ESNext", "DOM"]`（`tsconfig.json` 額外含 `ES7`）
- 目標與模組：`target: ESNext`、`module: commonjs`
- 建置：無綁定打包器（No bundler）。以 TypeScript 直接編譯為 JS，將輸出代碼注入頁面（DevTools 貼上、Userscript、或擴充套件）

## Project Architecture

高階流程（來源：copilot-instructions）：

1. 建立隱藏 `<iframe>` 取得「乾淨的」內建物件集合
2. 將 `window` 與 `iframe.contentWindow` 比對，找出多出的全域鍵並依型別歸類
3. 使用 `KeyCollector` 深入遍歷這些全域物件，生成穩定的「中括號表示法」存取路徑（例如 `window['Foo']['bar']`）
4. 掃描整個 DOM，尋找以 `__vue*` / `__react*` 開頭的屬性來識別 Vue/React 掛載根節點，並對其物件進行相同的鍵收集
5. 將 `$searchKey(key, fuzzy)` 方式暴露於全域以供查找

核心組件與約束：

- `newEval(code, safety=true)`：`new Function` 的包裝，用黑名單阻擋明顯危險代碼；讀值時以 `safety=false` 並包 `return <path>`
- `KeyCollector(ignoreProps)`：以 `WeakMap` 去循環、跳過 DOM `Node` 與 `Promise`，建立穩定路徑；常見忽略鍵：`length`、`arguments`、`caller`、`prototype`、`constructor`
- Vue 忽略：`__ob__`、`$options`、`_$vnode`；React 忽略：`memoizedState`、`updateQueue`、`refs`、`context`
- `MAX_DEPTH`（預設 `Infinity`）：限制遍歷深度；越小越省時省記憶體

## Getting Started

本專案不綁定打包器，建議以 TypeScript 直接編譯並將輸出注入目標頁面。

前置需求（可選）：

- Node.js（若要在本機編譯 TypeScript）
- 全域或本地 TypeScript 編譯器（`tsc`）

步驟 A：以 TypeScript 編譯並在 DevTools 注入

1. 於專案根目錄執行 TypeScript 編譯（輸出路徑以 `tsconfig.json` 為準）
2. 打開目標頁面 → 開發者工具（DevTools）→ Console
3. 將編譯後的 JS 內容貼上執行，即會在 `window` 上註冊 `$searchKey`

步驟 B：以 Userscript 或瀏覽器擴充功能注入

- 將編譯後 JS 作為 Userscript 或擴充模組內容載入，於載入網頁時自動執行

編譯設定提示：

- `tsconfig.json`：`outDir: "."`
- `jsconfig.json`：`outDir: "dist"`
  - 若要一致化，建議以 `tsconfig.json` 為主或將兩者調整為同一路徑

## Project Structure

- `main.ts`：入口檔，包含 `KeyCollector`、`newEval`、DOM 掃描與 `$searchKey` 注入
- `tsconfig.json`：TypeScript 編譯設定（目標 ESNext、CommonJS、嚴格模式、來源映射）
- `jsconfig.json`：編輯器輔助設定（若使用 JS/TS 混編時）
- `.github/copilot-instructions.md`：本專案工作原則與設計說明

## Key Features

- `$searchKey(key: string, fuzzy?: boolean)`
  - 精確搜尋：比對鍵名完全相符
  - 模糊搜尋：大小寫不敏感的部分匹配，跨全域/Vue/React 鍵集合
  - 回傳：`{ path: string, code: any }[]`，其中 `path` 為穩定中括號表示法
- 過濾原生函式：結果中排除原生函式（例如顯示為 `[native code]`）
- 安全讀值：以 `newEval('return ' + path, false)` 讀取值，並以黑名單阻擋危險字樣（在 `safety=true` 時）
- 遍歷控制：跳過 DOM `Node` 與 `Promise`，深度由 `MAX_DEPTH` 控制

## Development Workflow

- 建置與執行：
  - 編譯 `main.ts`，將產出 JS 注入目標頁面（手動貼上、Userscript 或擴充套件）
- 分支：
  - 預設分支：`main`
  - 開發分支：`dev`（當前）
- 效能建議：
  - 規模較大時，降低 `MAX_DEPTH`、擴充忽略清單、避免在巨量 DOM 上掃描

## Coding Standards

- 型別嚴格：`strict: true`、`noImplicitAny: true` 等設定
- 路徑風格：一律使用中括號表示法，支援數字與特殊鍵名（例如 `window['fetch']`、`obj[0]`）
- 錯誤處理：屬性存取包在 try/catch 內；拒訪或錯誤時略過
- 安全考量：
  - 讀值使用 `newEval(..., false)` 與黑名單避開危險片段
  - 迭代使用 `WeakMap` 斷循環引用；跳過 `Node` 與 `Promise`

## Testing

- 目前未附帶自動化測試，建議的手動驗證：
  1. 在任意網頁注入建置後的 JS
  2. 於 Console 呼叫：`$searchKey('fetch')`（精確）
  3. 於 Console 呼叫：`$searchKey('react', true)`（模糊）
  4. 檢視回傳陣列中 `path` 與 `code` 是否符合預期，並確認原生函式已被過濾
- 後續可考慮：以小型沙箱頁面（含 Vue/React root）做端對端快照測試

## Contributing

- 需求或修正請提交 Issue/PR（分支自 `dev` 或依既有流程）
- 參考：
  - 主要設計與使用說明見 [.github/copilot-instructions.md](.github/copilot-instructions.md)
- 開發建議：
  - 變更遍歷策略時，確保不會讀取或執行具副作用的屬性
  - 新增框架支援時（例如 Svelte、Angular），比照 Vue/React 模式：
    - 擴充忽略清單
    - 定位框架 root 的掛載點，將其物件交由 `KeyCollector`
  - 需要最佳化時優先：`MAX_DEPTH`、忽略清單、結果去重、屬性存取的 try/catch 範圍
