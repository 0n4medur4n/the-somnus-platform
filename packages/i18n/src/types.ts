/**
 * A single translation key, in dotted form, e.g. "auth.login.title".
 * The shape is derived at type-check time from the consumer's locale
 * dictionary, so the type-checker enforces key existence.
 */
export type I18nKey = string;

export type LocaleDictionary = Readonly<Record<I18nKey, string>>;
