// Tema compartilhado do sidepanel da extensão.
// Espelha os tokens do painel de controle (apps/web/src/index.css) e do site de
// marketing — tema CLARO, verde-limão como acento. Fonte única: substitui os
// objetos `T` duplicados que existiam em cada view.

export const T = {
  bg:          "#f4f7fb",
  card:        "#ffffff",
  surface:     "#edf2f7",
  hover:       "#e2e8f0",
  border:      "#dde4ee",
  borderLight: "#e8eef6",

  text:        "#1a2332",
  secondary:   "#4a5568",
  muted:       "#8898aa",

  green:       "#a3e635",        // acento (fundo de botão)
  greenDim:    "#7cb821",
  greenInk:    "#4a7c00",        // verde escuro p/ TEXTO sobre fundo claro
  greenBg:     "rgba(163,230,53,0.15)",

  red:         "#ef4444",
  yellow:      "#f59e0b",
  blue:        "#3b82f6",
  navy:        "#1a2332",
} as const;
