export const FontFamilies = {
  regular: "System",
  medium: "System",
  semibold: "System",
  bold: "System",
  monospace: "Courier New",
} as const;

export const FontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const FontSizes = {
  h1: 24,
  h2: 18,
  h3: 16,
  body: 14,
  caption: 12,
} as const;

export const LineHeights = {
  h1: 30,
  h2: 24,
  h3: 22,
  body: 20,
  caption: 16,
} as const;

export const LetterSpacing = {
  h1: -0.2,
  h2: -0.1,
  h3: 0,
  body: 0,
  caption: 0.1,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const Radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  round: 999,
} as const;

export const Typography = {
  h1: {
    fontFamily: FontFamilies.bold,
    fontWeight: FontWeights.bold,
    fontSize: FontSizes.h1,
    lineHeight: LineHeights.h1,
    letterSpacing: LetterSpacing.h1,
  },
  h2: {
    fontFamily: FontFamilies.semibold,
    fontWeight: FontWeights.semibold,
    fontSize: FontSizes.h2,
    lineHeight: LineHeights.h2,
    letterSpacing: LetterSpacing.h2,
  },
  h3: {
    fontFamily: FontFamilies.semibold,
    fontWeight: FontWeights.semibold,
    fontSize: FontSizes.h3,
    lineHeight: LineHeights.h3,
    letterSpacing: LetterSpacing.h3,
  },
  body: {
    fontFamily: FontFamilies.regular,
    fontWeight: FontWeights.regular,
    fontSize: FontSizes.body,
    lineHeight: LineHeights.body,
    letterSpacing: LetterSpacing.body,
  },
  caption: {
    fontFamily: FontFamilies.regular,
    fontWeight: FontWeights.regular,
    fontSize: FontSizes.caption,
    lineHeight: LineHeights.caption,
    letterSpacing: LetterSpacing.caption,
  },
} as const;

