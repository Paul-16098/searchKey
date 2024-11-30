"use strict";
/**
 * 最大搜索深度。此參數影響注入時間和內存佔用，謹慎修改
 */
const MAX_DEPTH = Infinity;
/**
 * 忽略的屬性
 */
const IGNORE_PROPS = new Set([
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
const VUE_IGNORE_PROPS = new Set([
    "__ob__", // Vue 的觀察者對象
    "$options", // Vue 實例的選項
    "_$vnode", // Vue 的虛擬節點
]);
/**
 * react額外忽略的屬性
 */
const REACT_IGNORE_PROPS = new Set([
    "memoizedState", // React 的內部狀態
    "updateQueue", // React 的更新隊列
    "refs", // React 的引用
    "context", // React 的上下文
]);
/**
 * 執行傳入的字符串代碼
 * @param stringCode 字符串代碼
 * @param safety 安全?
 * @returns 代碼
 */
function newEval(stringCode, safety = true) {
    const blackList = [
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
    if (safety &&
        blackList.some((value) => typeof value === "string"
            ? stringCode.includes(value)
            : value.test(stringCode))) {
        throw new Error(`不允許的關鍵字或代碼: ${stringCode}`);
    }
    return new Function(`${safety ? "return" : ""} ${stringCode}`)();
}
/**
 * 是否為純數字
 * @param str
 * @returns
 */
const isNum = (str) => /^\d+$/.test(str);
/**
 * 獲取類型
 * @param item
 * @returns
 */
const getType = (item) => Object.prototype.toString.call(item).slice(8, -1).toLowerCase();
/**
 * 獲取全屬性，包括原型鏈上的
 * @param obj
 * @returns
 */
function getAllProps(obj) {
    const props = new Set();
    while (obj && obj !== Object.prototype && obj !== Function.prototype) {
        Object.getOwnPropertyNames(obj).forEach((prop) => props.add(prop));
        obj = Object.getPrototypeOf(obj);
    }
    return props;
}
/**
 * 獲取所有元素和註釋節點
 * @returns
 */
function getAllNodes() {
    const result = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, null);
    let node;
    while ((node = walker.nextNode())) {
        result.push(node);
    }
    return result;
}
/**
 * 屬性收集類
 */
class KeyCollector {
    ignoreProps;
    allKeys = new Map();
    taskList = new Array();
    refs;
    tempKeys;
    discardKeys;
    constructor(ignoreProps) {
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
                    parent,
                },
            ],
        ]);
        this.tempKeys = new Map();
        this.discardKeys = new Map();
    }
    depthCache = new Map();
    _calcDepth(obj) {
        if (this.depthCache.has(obj)) {
            return this.depthCache.get(obj);
        }
        let depth = 0;
        let item = this.refs.get(obj);
        while (item && item.parent) {
            obj = item.parent;
            item = this.refs.get(obj);
            depth++;
        }
        this.depthCache.set(obj, depth);
        return depth;
    }
    async _collectKeys(obj, item, recordDiscard = true, depth = 0) {
        if (obj === null || (typeof obj !== "function" && typeof obj !== "object"))
            return;
        if (obj instanceof Node)
            return;
        if (MAX_DEPTH > 0 && depth >= MAX_DEPTH) {
            if (recordDiscard)
                this.discardKeys.set(obj, item);
            return;
        }
        console.debug("collectKeys:", obj, item, recordDiscard, depth);
        // @ts-expect-error
        if (this.refs.has(obj)) {
            // @ts-expect-error
            if (depth < this._calcDepth(obj))
                this.refs.set(obj, item);
            return;
        }
        // @ts-expect-error
        this.refs.set(obj, item);
        const keys = getAllProps(obj);
        for (const key of keys) {
            if (!this.ignoreProps.has(key)) {
                let value;
                try {
                    // @ts-expect-error
                    value = obj[key];
                }
                catch (e) {
                    continue;
                }
                if (value instanceof Promise) {
                    value.catch(() => { });
                    continue;
                }
                const val = this.tempKeys.get(key) || new Set();
                val.add({
                    value: value,
                    parent: obj,
                });
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
    _generatePath(obj) {
        if (obj.path)
            return;
        if (!obj.parent) {
            obj.path = obj.root;
            return;
        }
        const parent = this.refs.get(obj.parent);
        obj.extra = parent.extra;
        this._generatePath(parent);
        obj.path =
            parent.path + (isNum(obj.key) ? `[${obj.key}]` : `['${obj.key}']`);
    }
    _generateAllPaths() {
        for (const [key, val] of this.tempKeys) {
            for (const obj of val) {
                const item = this.refs.get(obj.value);
                if (item && item.key === key) {
                    if (!item.added) {
                        this._generatePath(item);
                        this.addKey(key, item.path, item.extra);
                        item.added = true;
                    }
                }
                else {
                    const parent = this.refs.get(obj.parent);
                    this._generatePath(parent);
                    const path = isNum(key)
                        ? `${parent.path}[${key}]`
                        : `${parent.path}['${key}']`;
                    this.addKey(key, path, parent.extra);
                }
            }
        }
    }
    addKey(key, path, extra = null) {
        const arr = this.allKeys.get(key) || new Set();
        // @ts-expect-error
        arr.add(extra ? { path, ...extra } : path);
        this.allKeys.set(key, arr);
    }
    collect(obj, root, extra = null) {
        console.debug("collect:", obj, root, extra);
        let key;
        if (extra) {
            key = extra.prop;
        }
        else {
            const keys = String.prototype.match.call(root, /(?<=[.\[]['"]?)[^'".\[\]]+/g);
            if (keys)
                key = keys.pop();
        }
        this.taskList.push(this._collectKeys(obj, { root, key, extra }));
    }
    async getAllKeys() {
        console.debug("getAllKeys:", this.taskList);
        await Promise.allSettled(this.taskList);
        // 處理丟棄的鍵
        await Promise.allSettled([...this.discardKeys.entries()].map(([obj, item]) => {
            const depth = this._calcDepth(item.parent) + 1;
            if (depth < MAX_DEPTH) {
                return this._collectKeys(obj, item, false, depth);
            }
        }));
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
    const iWindow = iframe.contentWindow;
    // 反劫持
    const { Object, String, Array, Set, Map, WeakMap, RegExp, Promise, console } = iWindow;
    // 獲取全局屬性
    const globalProps = new Object();
    const wKeys = Object.getOwnPropertyNames(window);
    const iKeys = Object.getOwnPropertyNames(iWindow);
    for (const key of wKeys) {
        if (!isNum(key) && !iKeys.includes(key)) {
            // @ts-expect-error
            const type = getType(window[key]);
            // @ts-expect-error
            globalProps[type] = globalProps[type] || new Array();
            // @ts-expect-error
            globalProps[type].push(key);
        }
    }
    console.log(`${tag} 全局屬性：\n`, globalProps);
    // 注入函數
    const kc = new KeyCollector(IGNORE_PROPS);
    for (const type in globalProps) {
        // @ts-expect-error
        for (const key of globalProps[type]) {
            const path = `window['${key}']`;
            kc.addKey(key, path);
            kc.collect(window[key], path);
        }
    }
    const globalKeys = await kc.getAllKeys();
    const vkc = new KeyCollector(new Set([...IGNORE_PROPS, ...VUE_IGNORE_PROPS]));
    const rkc = new KeyCollector(new Set([...IGNORE_PROPS, ...REACT_IGNORE_PROPS]));
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
     * @param key 內容名
     * @param fuzzy 是否模糊搜索
     */
    function $searchKey(key, fuzzy = false) {
        const result = new Array();
        const dataResult = new Array();
        if (fuzzy) {
            const lowerKey = key.toLowerCase();
            for (const _key of globalKeys.keys()) {
                if (_key.toLowerCase().includes(lowerKey)) {
                    result.push(...globalKeys.get(_key));
                }
            }
            for (const _key of vueKeys.keys()) {
                if (_key.toLowerCase().includes(lowerKey)) {
                    result.push(...vueKeys.get(_key));
                }
            }
            for (const _key of reactKeys.keys()) {
                if (_key.toLowerCase().includes(lowerKey)) {
                    result.push(...reactKeys.get(_key));
                }
            }
        }
        else {
            // 此段代碼用於從不同的鍵集合中合併結果
            // globalKeys、vueKeys、reactKeys是包含相關鍵的映射
            // key是當前需要查找的鍵
            // 將找到的結果存儲在result數組中
            const globalResult = globalKeys.get(key) || [];
            const vueResult = vueKeys.get(key) || [];
            const reactResult = reactKeys.get(key) || [];
            result.push(...globalResult, ...vueResult, ...reactResult);
        }
        // 遍歷結果數組，將每個元素及其評估結果存入數據結果數組。
        const evaluations = result.map((element) => `return ${element}`);
        const evaluatedCodes = evaluations.map((evalStr) => newEval(evalStr, false));
        evaluatedCodes.forEach((code, index) => {
            dataResult.push({
                path: result[index],
                code: code,
            });
        });
        return dataResult.filter((item) => {
            if (!item)
                return false;
            if (typeof item.code === "function") {
                const funcStr = item.code.toString();
                const funcName = item.path.split("'").slice(-2, -1)[0];
                return funcStr !== `function ${funcName}() { [native code] }`;
            }
            return true;
        });
    }
    console.log(`$searchKey函數已注入！`, $searchKey);
});
//# sourceMappingURL=main.js.map