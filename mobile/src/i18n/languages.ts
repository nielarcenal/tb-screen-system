/** Supported UI languages (brief: trilingual en / tl / ceb). Side-effect free so
 *  stores can import the type without pulling in i18next initialization. */
export const SUPPORTED_LANGUAGES = ['en', 'tl', 'ceb'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
