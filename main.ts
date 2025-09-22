/**
 * 最大搜索深度。此參數影響注入時間和內存佔用，謹慎修改
 */
const MAX_DEPTH: number = Infinity;

/**
 * $searchKey 回傳結果型別
 */
type SearchResult = { path: string; code: any };

// 在 script 檔中可直接擴充 Window 以供型別提示（不轉成模組）
interface Window {
  $searchKey?: (key: string, fuzzy?: boolean) => SearchResult[];
}

/**
 * 忽略的屬性
 */
const IGNORE_PROPS: Set<string> = new Set<string>([
  // 忽略數組長度
  "length",
  // 忽略函數參數
  "arguments",
  // 忽略函數調用者
  "caller",
  // 忽略原型
  "prototype",
  // 忽略構造函數
  "constructor",
]);

/**
 * vue額外忽略的屬性
 */
const VUE_IGNORE_PROPS: Set<string> = new Set([
  "__ob__", // Vue 的觀察者對象
  "$options", // Vue 實例的選項
  "_$vnode", // Vue 的虛擬節點
]);

/**
 * react額外忽略的屬性
 */
const REACT_IGNORE_PROPS: Set<string> = new Set([
  "memoizedState", // React 的內部狀態
  "updateQueue", // React 的更新隊列
  "refs", // React 的引用
  "context", // React 的上下文
]);

/**
 * Safely evaluates a string of JavaScript code with an optional safety check.
 *
 * @param stringCode - The string of JavaScript code to evaluate.
 * @param safety - A boolean indicating whether to perform a safety check on the code. Default is true.
 * @returns The result of the evaluated code.
 * @throws Will throw an error if the safety check is enabled and the code contains blacklisted keywords or patterns.
 */
function newEval(stringCode: string, safety: boolean = true) {
  const blackList: Array<string | RegExp> = [
    "eval",
    "function",
    "let",
    "var",
    "document",
    "alert",
    "navigator",
    "localStorage",
    "sessionStorage",
    "console",
    "XMLHttpRequest",
    "fetch",
    "import",
    "export",
    "async",
    "await",
    "with",
    "Promise",
    /window\.[0-9a-zA-Z_]+ *=/,
  ];

  if (
    safety &&
    blackList.some((value) =>
      typeof value === "string"
        ? stringCode.includes(value)
        : value.test(stringCode)
    )
  ) {
    throw new Error(`不允許的關鍵字或代碼: ${stringCode}`);
  }

  return new Function(`${safety ? "return" : ""} ${stringCode}`)();
}

/**
 * 是否為純數字
 * @param str
 * @returns boolean
 */
function isNum(str: string): boolean {
  return /^\d+$/.test(str);
}

/**
 * Returns the type of the given item as a lowercase string.
 *
 * @param item - The item whose type is to be determined.
 * @returns The type of the item as a lowercase string.
 */
function getType(item: any): string {
  return Object.prototype.toString.call(item).slice(8, -1).toLowerCase();
}

/**
 * Retrieves all property names (including inherited ones) from an object.
 *
 * @param obj - The object from which to retrieve the property names.
 * @returns A Set containing all property names of the object.
 */
function getAllProps(obj: any): Set<string> {
  const props = new Set<string>();
  while (obj && obj !== Object.prototype && obj !== Function.prototype) {
    Object.getOwnPropertyNames(obj).forEach((prop) => props.add(prop));
    obj = Object.getPrototypeOf(obj);
  }
  return props;
}

/**
 * Retrieves all nodes in the document, including elements and comments.
 *
 * This function uses a TreeWalker to traverse the entire document starting
 * from the document's root element. It collects all nodes that are either
 * elements or comments and returns them in an array.
 *
 * @returns {Node[]} An array containing all element and comment nodes in the document.
 */
function getAllNodes(): Node[] {
  const result: Node[] = [];
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
    null
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    result.push(node);
  }

  return result;
}

/**
 * 屬性收集類
 */
class KeyCollector {
  ignoreProps: Set<string>;
  allKeys = new Map<string, Set<string | { path: string; [k: string]: any }>>();
  taskList = new Array<Promise<any>>();
  refs!: WeakMap<
    object,
    {
      path?: string;
      root: string;
      parent?: any;
      extra?: any;
      key?: any;
      added?: boolean;
    }
  >;
  tempKeys!: Map<string, Set<{ value: any; parent: any }>>;
  discardKeys!: Map<any, { root: any; parent?: any; key?: any; extra: any }>;
  constructor(ignoreProps: Set<string>) {
    this.ignoreProps = ignoreProps;
    this._init();
  }
  _init() {
    console.debug("init KeyCollector");
    this.refs = new WeakMap([
      [
        window,
        {
          path: "window",
          root: "window",
          // root 沒有父層，避免 window.parent===window 導致深度計算死循環
          parent: undefined,
        },
      ],
    ]);
    this.tempKeys = new Map();
    this.discardKeys = new Map();
  }
  private depthCache: Map<any, number> = new Map();

  _calcDepth(obj: any) {
    const start = obj;
    if (this.depthCache.has(start)) {
      return this.depthCache.get(start)!;
    }
    let depth = 0;
    let current = obj;
    let item = this.refs.get(current);
    // 逐層往上直到沒有 parent
    while (item && item.parent) {
      current = item.parent;
      item = this.refs.get(current);
      depth++;
      // 安全防護：深度異常時提前退出
      if (depth > 1e4) break;
    }
    this.depthCache.set(start, depth);
    return depth;
  }
  async _collectKeys(
    obj: { [x: string]: any } | null,
    item: { root: any; parent?: any; key?: any; extra: any },
    recordDiscard = true,
    depth = 0
  ) {
    if (obj === null || (typeof obj !== "function" && typeof obj !== "object"))
      return;
    if (obj instanceof Node) return;
    if (MAX_DEPTH > 0 && depth >= MAX_DEPTH) {
      if (recordDiscard) this.discardKeys.set(obj, item);
      return;
    }
    console.debug("collectKeys:", obj, item, recordDiscard, depth);
    if (this.refs.has(obj as object)) {
      if (depth < this._calcDepth(obj)) this.refs.set(obj, item);
      return;
    }
    this.refs.set(obj, item);
    const keys = getAllProps(obj);
    for (const key of keys) {
      if (!this.ignoreProps.has(key)) {
        let value;
        try {
          value = (obj as any)[key];
        } catch (e) {
          continue;
        }
        if (value instanceof Promise) {
          value.catch(() => {});
          continue;
        }
        const val =
          this.tempKeys.get(key) || new Set<{ value: any; parent: any }>();
        val.add({ value, parent: obj });
        this.tempKeys.set(key, val);
        const _item = {
          root: item.root,
          parent: obj,
          key: key,
          extra: item.extra,
        };
        await this._collectKeys(value, _item, recordDiscard, depth + 1);
      }
    }
  }
  _generatePath(obj: {
    path: string;
    parent: any;
    root: any;
    extra: any;
    key: any;
  }) {
    if (obj.path) return;
    if (!obj.parent) {
      obj.path = obj.root;
      return;
    }
    const parent: any = this.refs.get(obj.parent);
    obj.extra = parent.extra;
    this._generatePath(parent);
    obj.path =
      parent.path + (isNum(obj.key) ? `[${obj.key}]` : `['${obj.key}']`);
  }
  _generateAllPaths() {
    for (const [key, val] of this.tempKeys) {
      for (const obj of val) {
        const item = this.refs.get(obj.value) as {
          [x: string]: any;
          path: string;
          root: string;
          parent: Window;
          extra: any;
          key: any;
        };
        if (item && item.key === key) {
          if (!item.added) {
            this._generatePath(item);
            this.addKey(key, item.path, item.extra);
            item.added = true;
          }
        } else {
          const parent = this.refs.get(obj.parent) as {
            [x: string]: any;
            path: string;
            root: string;
            parent: Window;
            extra: any;
            key: any;
          };
          this._generatePath(parent);
          const path = isNum(key)
            ? `${parent.path}[${key}]`
            : `${parent.path}['${key}']`;
          this.addKey(key, path, parent.extra);
        }
      }
    }
  }
  addKey(key: any, path: string, extra = null) {
    const arr =
      this.allKeys.get(key) ||
      new Set<string | { path: string; [k: string]: any }>();
    if (extra && typeof extra === "object") {
      arr.add({ path, ...(extra as Record<string, any>) });
    } else {
      arr.add(path);
    }
    this.allKeys.set(key, arr);
  }
  collect(obj: Window, root: string, extra: any = null) {
    console.debug("collect:", obj, root, extra);
    let key;
    if (extra && Object.prototype.hasOwnProperty.call(extra, "prop")) {
      key = extra.prop;
    } else {
      const keys = String.prototype.match.call(
        root,
        /(?<=[.\[]['"]?)[^'".\[\]]+/g
      );
      if (keys) key = keys.pop();
    }
    this.taskList.push(this._collectKeys(obj, { root, key, extra }));
  }
  async getAllKeys() {
    console.debug("getAllKeys:", this.taskList);
    await Promise.allSettled(this.taskList);
    // 處理丟棄的鍵
    await Promise.allSettled(
      [...this.discardKeys.entries()].map(([obj, item]) => {
        const depth = this._calcDepth(item.parent) + 1;
        if (depth < MAX_DEPTH) {
          return this._collectKeys(obj, item, false, depth);
        }
      })
    );
    this._generateAllPaths();
    this._init();
    return this.allKeys;
  }
}

const tag = window === window.top ? "top" : location.origin + location.pathname;

(function (name, func) {
  func();
  return 0;
})(tag, async () => {
  const iframe = document.createElement("iframe");
  iframe.id = "iframe_for_test";
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  let iWindow = iframe.contentWindow as typeof window | null;
  try {
    if (!iWindow) throw new Error("iframe.contentWindow is null");

    // 反劫持：從乾淨 iWindow 取出內建構造
    const {
      Object,
      String,
      Array,
      Set,
      Map,
      WeakMap,
      RegExp,
      Promise,
      console,
    } = iWindow;

    // 獲取全局屬性差異
    const globalProps = new Object();
    const wKeys = Object.getOwnPropertyNames(window);
    const iKeys = Object.getOwnPropertyNames(iWindow);
    for (const key of wKeys) {
      if (!isNum(key) && !iKeys.includes(key)) {
        // @ts-expect-error - 動態分類 by type
        const type = getType(window[key]);
        // @ts-expect-error
        globalProps[type] = globalProps[type] || new Array();
        // @ts-expect-error
        globalProps[type].push(key);
      }
    }
    console.log(`${tag} 全局屬性：\n`, globalProps);

    // 注入函數：蒐集全域鍵
    const kc = new KeyCollector(IGNORE_PROPS);
    for (const type in globalProps) {
      // @ts-expect-error - 動態走訪
      for (const key of globalProps[type]) {
        const path = `window['${key}']`;
        kc.addKey(key, path);
        kc.collect((window as any)[key], path);
      }
    }
    const globalKeys = await kc.getAllKeys();

    // 掃描框架掛載節點
    const vkc = new KeyCollector(
      new Set([...IGNORE_PROPS, ...VUE_IGNORE_PROPS])
    );
    const rkc = new KeyCollector(
      new Set([...IGNORE_PROPS, ...REACT_IGNORE_PROPS])
    );
    for (const node of getAllNodes()) {
      for (const prop of Object.getOwnPropertyNames(node)) {
        if (prop.startsWith("__vue")) {
          // @ts-expect-error
          vkc.collect(node[prop], `node['${prop}']`, { node });
        }
        if (prop.startsWith("__react")) {
          // @ts-expect-error
          rkc.collect(node[prop], `node['${prop}']`, { node });
        }
      }
    }
    const vueKeys = await vkc.getAllKeys();
    const reactKeys = await rkc.getAllKeys();
    /**
     * Searches for a key in multiple key collections and returns an array of objects containing the path and evaluated code.
     *
     * @param {string} key - The key to search for.
     * @param {boolean} [fuzzy=false] - Whether to perform a fuzzy search (case-insensitive and partial match).
     * @returns {{ path: string; code: any; }[]} An array of objects, each containing the path and evaluated code.
     *
     * The function searches through three key collections: `globalKeys`, `vueKeys`, and `reactKeys`.
     * If `fuzzy` is true, it performs a case-insensitive search and includes keys that partially match the input key.
     * If `fuzzy` is false, it performs an exact match search.
     *
     * The results are evaluated using the `newEval` function and filtered to exclude native functions.
     */
    function $searchKey(key: string, fuzzy: boolean = false): SearchResult[] {
      const resultPaths: Array<string> = new Array();
      const dataResult: SearchResult[] = new Array();

      const toPaths = (set: Set<any> | undefined): string[] => {
        if (!set) return [];
        const out: string[] = [];
        for (const entry of set) {
          if (typeof entry === "string") out.push(entry);
          else if (
            entry &&
            typeof entry === "object" &&
            typeof entry.path === "string"
          )
            out.push(entry.path);
        }
        return out;
      };

      if (fuzzy) {
        const lowerKey = key.toLowerCase();
        for (const _key of globalKeys.keys()) {
          if (_key.toLowerCase().includes(lowerKey)) {
            resultPaths.push(...toPaths(globalKeys.get(_key)));
          }
        }
        for (const _key of vueKeys.keys()) {
          if (_key.toLowerCase().includes(lowerKey)) {
            resultPaths.push(...toPaths(vueKeys.get(_key)));
          }
        }
        for (const _key of reactKeys.keys()) {
          if (_key.toLowerCase().includes(lowerKey)) {
            resultPaths.push(...toPaths(reactKeys.get(_key)));
          }
        }
      } else {
        // 此段代碼用於從不同的鍵集合中合併結果
        // globalKeys、vueKeys、reactKeys是包含相關鍵的映射
        // key是當前需要查找的鍵
        // 將找到的結果存儲在result數組中
        resultPaths.push(
          ...toPaths(globalKeys.get(key)),
          ...toPaths(vueKeys.get(key)),
          ...toPaths(reactKeys.get(key))
        );
      }
      // 去重
      const uniquePaths = Array.from(new Set(resultPaths));

      // 遍歷結果數組，將每個元素及其評估結果存入數據結果數組。
      const evaluations = uniquePaths.map((element) => `return ${element}`);
      const evaluatedCodes = evaluations.map((evalStr) => {
        try {
          return newEval(evalStr, false);
        } catch {
          return undefined;
        }
      });

      evaluatedCodes.forEach((code, index) => {
        dataResult.push({ path: uniquePaths[index], code });
      });

      return dataResult.filter((item) => {
        if (!item) return false;
        if (typeof item.code === "function") {
          const funcStr = String(item.code);
          // 過濾原生函數
          if (/\[native code\]/.test(funcStr)) return false;
          return true;
        }
        return true;
      });
    }
    // 將函數暴露到全域以便於在控制台或其他腳本中使用（避免覆蓋既有同名函數）
    if (!window.$searchKey) {
      window.$searchKey = $searchKey;
      console.log(`$searchKey函數已注入！`, $searchKey);
    } else {
      console.log(`$searchKey 已存在，跳過重新注入。`);
    }
  } finally {
    // 清理隱藏 iframe，避免長駐 DOM
    try {
      iframe.remove();
    } catch {
      /* noop */
    }
  }
});
