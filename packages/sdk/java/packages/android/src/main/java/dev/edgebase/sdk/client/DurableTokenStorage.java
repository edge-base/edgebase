package dev.edgebase.sdk.client;

/**
 * Opt-in contract for token storage that survives process restart and reports
 * failed writes. Irreversible anonymous-account upgrades require this type.
 */
public interface DurableTokenStorage extends TokenStorage {
}
