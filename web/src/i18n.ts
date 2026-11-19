export type Lang = "ja" | "en";

const dict = {
  ja: {
    tagline: "行きたい場所の地図を、感熱プリンタで刷れる小さな一枚に。",
    place1: "場所 1",
    place1Ph: "例: 新宿駅、自宅の住所",
    place2: "場所 2（任意）",
    place2Ph: "例: 東京都庁",
    scale: "範囲（地図の一辺）",
    printer: "プリンタ",
    dpi200: "200dpi（T02等）",
    dpi300: "300dpi（M02S等）",
    generate: "地図をつくる",
    generating: "つくってるよ…",
    useLocation: "現在地を使う",
    here: "現在地",
    previewTitle: "原画で位置合わせ",
    previewHint: "ドラッグで移動、ピンチ／ホイール／Ctrl+± で拡大縮小できます",
    renderFramed: "この範囲で描画する",
    geoFailed: "現在地を取得できませんでした。位置情報の許可を確認してみてね。",
    resultTitle: "できあがり",
    footerNote: "地図データは OpenStreetMap を使っています。住所検索の一部は国土地理院（CSISシンプルジオコーディング）を利用しています",
    share: "共有",
    save: "保存",
    print: "印刷",
    close: "閉じる",
    retry: "再試行",
    styleLine: "線画",
    styleGray: "グレー",
    expanded: "2点が収まる {km}km に広げました",
    notFound: "「{q}」が見つかりませんでした。近くの駅や住所で検索して、原画プレビューで位置を合わせることもできます。",
    precision_ban: "住所は番地まで判別できましたが、ピンの位置は目安です。実際の場所と 100 m 以上ずれることもあるので、原画プレビューで必ず確認してください。",
    precision_chome: "住所は丁目レベルまでしか一致しませんでした。ピンは概略の位置です。原画プレビューで正しい位置に合わせてください。",
    precision_area: "住所は町名レベルまでしか一致しませんでした。ピンは概略の位置です。原画プレビューで正しい位置に合わせてください。",
    pickCandidate: "どちらの場所ですか？",
    tooFar: "2点が離れすぎていて、1枚に収まりません（上限 20km）。",
    needPlace: "場所 1 を入れてね。",
    failedBoth: "地図を作れませんでした。通信状態を確認して、もう一度試してみてね。",
    lineFailed: "線画は取得できませんでした",
    grayFailed: "グレー版は作れませんでした",
    shareUnsupported: "このブラウザは共有に対応していないので、保存を使ってね。",
    savedNote: "保存しました",
  },
  en: {
    tagline: "Turn a place into a tiny map you can print on a thermal printer.",
    place1: "Place 1",
    place1Ph: "e.g. Shinjuku Station or your address",
    place2: "Place 2 (optional)",
    place2Ph: "e.g. Tokyo Metropolitan Government Building",
    scale: "Range (one side of the map)",
    printer: "Printer",
    dpi200: "200 dpi (T02 etc.)",
    dpi300: "300 dpi (M02S etc.)",
    generate: "Make my map",
    generating: "Making…",
    useLocation: "Use my location",
    here: "Current location",
    previewTitle: "Adjust on the original map",
    previewHint: "Drag to move; pinch, wheel or Ctrl+± to zoom",
    renderFramed: "Render this view",
    geoFailed: "Could not get your location. Please check the location permission.",
    resultTitle: "Your maps",
    footerNote: "Map data from OpenStreetMap. Some address search via GSI / CSIS (Japan).",
    share: "Share",
    save: "Save",
    print: "Print",
    close: "Close",
    retry: "Retry",
    styleLine: "Line",
    styleGray: "Gray",
    expanded: "Widened to {km} km so both places fit",
    notFound: "Could not find “{q}”. Try a nearby station or address — you can then adjust the position on the original map.",
    precision_ban: "The address was read to block level, but the pin is only approximate — it can be off by more than 100 m. Always check the position on the original-map preview.",
    precision_chome: "The address matched only to district level. The pin is a rough position — please line it up on the original-map preview.",
    precision_area: "The address matched only to town-name level. The pin is a rough position — please line it up on the original-map preview.",
    pickCandidate: "Which one do you mean?",
    tooFar: "The two places are too far apart for one map (max 20 km).",
    needPlace: "Please enter Place 1.",
    failedBoth: "Could not make the map. Check your connection and try again.",
    lineFailed: "Line style unavailable",
    grayFailed: "Gray style unavailable",
    shareUnsupported: "This browser cannot share; please use Save instead.",
    savedNote: "Saved",
  },
} as const;

export type I18nKey = keyof (typeof dict)["ja"];

let current: Lang = "ja";
const listeners: Array<() => void> = [];

export function detectLang(): Lang {
  const saved = localStorage.getItem("minimapprint-lang");
  if (saved === "ja" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  localStorage.setItem("minimapprint-lang", lang);
  document.documentElement.lang = lang;
  applyToDom();
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

export function t(key: I18nKey, params: Record<string, string> = {}): string {
  let s: string = dict[current][key];
  for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
}

export function applyToDom(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as I18nKey);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh as I18nKey);
  });
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = current === "ja" ? "EN" : "あ";
}

export function initI18n(): void {
  current = detectLang();
  document.documentElement.lang = current;
  applyToDom();
}
