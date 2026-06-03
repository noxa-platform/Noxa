/**
 * 初回案内（メニュー/指名タブレット）の型。
 * パネル本体は seating_casts（StoredCast）を流用し、メニュー用の拡張フィールドを足す。
 * 情報カード（名前なしラベルパネル）は menu_info_cards に独立保存。
 */

export type MenuColor = 'yellow' | 'red' | 'blue' | 'green';
export const COLOR_ORDER: MenuColor[] = ['yellow', 'red', 'blue', 'green'];
export const COLOR_HEX: Record<MenuColor, string> = {
  yellow: '#d4af37', red: '#e26d6d', blue: '#6da5e2', green: '#6ad080',
};
export const COLOR_LABEL: Record<MenuColor, string> = {
  yellow: 'Yellow', red: 'Red', blue: 'Blue', green: 'Green',
};

/** seating_casts ドキュメントに足すメニュー用の拡張フィールド（すべて任意・席回しは無視） */
export type CastMenuFields = {
  ruby?: string;
  title?: string;        // 役職（自由入力。rank とは別）
  isNewFace?: boolean;   // NEW バッジ
  selectable?: boolean;  // タブレットで指名選択可能か（既定 true）
  menuVisible?: boolean; // メニューに表示するか（既定 true）
  menuOrder?: number;    // メニュー表示順
  imgX?: number;         // 画像 object-position X(%)
  imgY?: number;         // 画像 object-position Y(%)
  imgScale?: number;     // 画像 scale(%)
};

/** 情報カード（名前なしラベルのみのパネル） */
export type InfoCard = {
  id: string;
  label: string;
  menuOrder?: number;
  menuVisible?: boolean;
  imgX?: number;
  imgY?: number;
  imgScale?: number;
};

/** グリッドに描画する統一パネル */
export type MenuPanel = {
  id: string;
  kind: 'cast' | 'info';
  name: string;       // info の場合は ''（label を使う）
  ruby: string;
  title: string;
  label: string;
  isNewFace: boolean;
  selectable: boolean; // info は常に false
  visible: boolean;
  order: number;
  imgX: number;
  imgY: number;
  imgScale: number;
  image: string;      // data:URL（menu_images から）。無ければ ''
};

/** 指名オーダー（menu_orders） */
export type MenuOrderCast = { id: string; name: string; title: string };
export type MenuOrder = {
  id: string;
  seat: string;           // 卓名（seating_tables の name）
  tableId: string | null; // 連携した卓 id（一致時）
  customerName: string;
  memo: string;
  color: MenuColor;
  casts: MenuOrderCast[];
  source: string;         // 'main' | 'preview'
  createdAtMs: number;
};

/** 表示設定（menu_config/main） */
export type MenuConfig = {
  nameFontSize: number;
  titleFontSize: number;
  fsNameFontSize: number;
  fsTitleFontSize: number;
  skipOrderInput: boolean;
};

export const DEFAULT_MENU_CONFIG: MenuConfig = {
  nameFontSize: 20, titleFontSize: 13, fsNameFontSize: 44, fsTitleFontSize: 24, skipOrderInput: false,
};
